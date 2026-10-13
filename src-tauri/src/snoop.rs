//! What Verity peeks at to tease you about ("Snoop around" in Settings): the apps
//! you have installed, your Steam games and how long you've played them, what
//! landed in your Downloads (file types only, never names), and, only with the
//! separate "Websites" switch on, which websites you visited today (site names
//! and visit counts only, never pages or titles). Read on this PC and handed to
//! his window; none of it leaves this PC.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DAY: Duration = Duration::from_secs(24 * 3600);
const MAX_GAMES: usize = 12;
const MAX_SITES: usize = 8;

#[derive(Clone, Default, serde::Serialize)]
pub struct Snoop {
    /// Installed apps' names, as the app menu shows them.
    apps: Vec<String>,
    /// Steam games, the most recently played first.
    games: Vec<Game>,
    /// Websites visited in the last day and how often, the most visited first.
    sites: Vec<(String, u32)>,
    /// Downloads: files in the folder, and the types of those added in the last day (most first).
    downloads: Option<Downloads>,
}

#[derive(Clone, serde::Serialize)]
struct Game {
    name: String,
    hours: f64,
    /// Unix seconds, 0 if never.
    last_played: u64,
}

#[derive(Clone, serde::Serialize)]
struct Downloads {
    total: u32,
    recent: Vec<(String, u32)>,
}

/// Everything he looks at; the websites only if `sites` (they have their own switch).
pub fn snoop(sites: bool) -> Snoop {
    remove_leftover_copies();
    let Some(home) = home() else { return Snoop::default() };
    Snoop {
        apps: apps(&home),
        games: games(&home),
        sites: if sites { self::sites(&home) } else { Vec::new() },
        downloads: downloads(&home),
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// The entries of a folder (none if it can't be read).
fn entries(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn ago(t: SystemTime) -> Duration {
    SystemTime::now().duration_since(t).unwrap_or_default()
}

// ---------- Installed apps ----------

fn apps(home: &Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    #[cfg(target_os = "linux")]
    {
        // The user's own folder first: a file there hides or replaces the system one with the same name.
        let data = env_dir("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local/share"));
        let system = std::env::var("XDG_DATA_DIRS").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        let mut dirs = vec![data.join("applications"), data.join("flatpak/exports/share/applications")];
        dirs.extend(system.split(':').map(|d| Path::new(d).join("applications")));
        dirs.extend(["/var/lib/flatpak/exports/share/applications", "/var/lib/snapd/desktop/applications"].map(PathBuf::from));
        let mut seen = std::collections::HashSet::new();
        for f in dirs.iter().flat_map(|d| entries(d)) {
            if f.extension().is_some_and(|e| e == "desktop") && seen.insert(f.file_name().unwrap_or_default().to_owned()) {
                names.extend(fs::read_to_string(&f).ok().and_then(|s| desktop_name(&s)));
            }
        }
    }
    #[cfg(windows)]
    {
        // The Start menu's shortcuts, minus uninstallers and help files.
        let roots = [env_dir("ProgramData").map(|p| p.join(r"Microsoft\Windows\Start Menu\Programs")), env_dir("APPDATA").map(|p| p.join(r"Microsoft\Windows\Start Menu\Programs"))];
        let mut stack: Vec<PathBuf> = roots.into_iter().flatten().collect();
        while let Some(dir) = stack.pop() {
            for p in entries(&dir) {
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
                    let name = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let lower = name.to_lowercase();
                    if !["uninstall", "readme", "help", "documentation", "website", "release notes"].iter().any(|w| lower.contains(w)) {
                        names.push(name);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for dir in [PathBuf::from("/Applications"), home.join("Applications"), PathBuf::from("/System/Applications")] {
            for p in entries(&dir) {
                if p.extension().is_some_and(|e| e == "app") {
                    names.push(p.file_stem().unwrap_or_default().to_string_lossy().to_string());
                }
            }
        }
    }
    let _ = home;
    names.retain(|n| !n.trim().is_empty());
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by_key(|n| n.to_lowercase());
    names
}

/// A .desktop file's Name, unless it's hidden from the app menu.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_name(file: &str) -> Option<String> {
    let mut in_entry = false;
    let mut name = None;
    for line in file.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
        } else if in_entry {
            match line.split_once('=').map(|(k, v)| (k.trim(), v.trim())) {
                Some(("Name", v)) => name = Some(v.to_string()),
                Some(("NoDisplay" | "Hidden", "true")) => return None,
                Some(("Type", t)) if t != "Application" => return None,
                _ => {}
            }
        }
    }
    name
}

// ---------- Steam ----------

/// A Valve KeyValues (.vdf/.acf) file: quoted keys with a quoted value or a { block }.
#[derive(Debug)]
enum Vdf {
    Str(String),
    Map(Vec<(String, Vdf)>),
}

/// A .vdf file's pieces.
enum Token {
    Str(String),
    Open,
    Close,
}

impl Vdf {
    fn parse(src: &str) -> Vdf {
        let mut tokens = Vec::new();
        let mut chars = src.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    let mut s = String::new();
                    while let Some(c) = chars.next() {
                        match c {
                            '\\' => s.extend(chars.next()),
                            '"' => break,
                            c => s.push(c),
                        }
                    }
                    tokens.push(Token::Str(s));
                }
                '{' => tokens.push(Token::Open),
                '}' => tokens.push(Token::Close),
                '/' if chars.peek() == Some(&'/') => {
                    for c in chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        Vdf::Map(Self::block(&mut tokens.into_iter()))
    }

    /// Key-value pairs up to the end of the block (or the file).
    fn block(it: &mut impl Iterator<Item = Token>) -> Vec<(String, Vdf)> {
        let mut out = Vec::new();
        while let Some(Token::Str(key)) = it.next() {
            match it.next() {
                Some(Token::Open) => out.push((key, Vdf::Map(Self::block(it)))),
                Some(Token::Str(v)) => out.push((key, Vdf::Str(v))),
                _ => break,
            }
        }
        out
    }

    /// The value under `key` (case doesn't matter: Steam isn't consistent).
    fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Map(m) => m.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }

    fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }

    fn str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Map(_) => None,
        }
    }

    fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Map(m) => m,
            Vdf::Str(_) => &[],
        }
    }
}

fn steam_dirs(home: &Path) -> Vec<PathBuf> {
    let _ = home;
    #[cfg(target_os = "linux")]
    return vec![home.join(".local/share/Steam"), home.join(".steam/steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")];
    #[cfg(windows)]
    return steam_registry_path().into_iter().chain([env_dir("ProgramFiles(x86)"), env_dir("ProgramFiles")].into_iter().flatten().map(|p| p.join("Steam"))).collect();
    #[cfg(target_os = "macos")]
    return vec![home.join("Library/Application Support/Steam")];
    #[allow(unreachable_code)]
    Vec::new()
}

/// Where Steam says it's installed (it may be on another drive).
#[cfg(windows)]
fn steam_registry_path() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    // "    SteamPath    REG_SZ    c:/program files (x86)/steam"
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.trim_start().starts_with("SteamPath"))?;
    let path = line.split_once("REG_SZ")?.1.trim();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn games(home: &Path) -> Vec<Game> {
    let Some(steam) = steam_dirs(home).into_iter().find(|d| d.join("steamapps").is_dir()) else { return Vec::new() };
    // Installed games' names, from every library's app manifests.
    let mut libraries = vec![steam.clone()];
    if let Ok(src) = fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
        let vdf = Vdf::parse(&src);
        for (_, lib) in vdf.get("libraryfolders").map(Vdf::entries).unwrap_or_default() {
            if let Some(p) = lib.get("path").and_then(Vdf::str) {
                libraries.push(PathBuf::from(p));
            }
        }
    }
    let mut names: HashMap<String, String> = HashMap::new();
    for lib in &libraries {
        for f in entries(&lib.join("steamapps")) {
            let file = f.file_name().unwrap_or_default().to_string_lossy();
            if !(file.starts_with("appmanifest_") && file.ends_with(".acf")) {
                continue;
            }
            let Ok(src) = fs::read_to_string(&f) else { continue };
            let vdf = Vdf::parse(&src);
            let (Some(id), Some(name)) = (vdf.path(&["AppState", "appid"]).and_then(Vdf::str), vdf.path(&["AppState", "name"]).and_then(Vdf::str)) else { continue };
            // Not tools: Proton, runtimes, redistributables.
            if !["Proton", "Steam Linux Runtime", "Steamworks Common", "Steam Runtime"].iter().any(|t| name.starts_with(t)) {
                names.insert(id.to_string(), name.to_string());
            }
        }
    }
    // Playtime, from each Steam account's local config (the most hours and latest play of any account on this PC).
    let mut played: HashMap<String, (f64, u64)> = HashMap::new();
    for user in entries(&steam.join("userdata")) {
        let Ok(src) = fs::read_to_string(user.join("config/localconfig.vdf")) else { continue };
        let vdf = Vdf::parse(&src);
        let Some(apps) = vdf.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) else { continue };
        for (id, app) in apps.entries() {
            let num = |k: &str| app.get(k).and_then(Vdf::str).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let (hours, last) = (num("Playtime") as f64 / 60.0, num("LastPlayed"));
            let e = played.entry(id.clone()).or_default();
            *e = (e.0.max(hours), e.1.max(last));
        }
    }
    let mut games: Vec<Game> = names
        .into_iter()
        .map(|(id, name)| {
            let (hours, last_played) = played.get(&id).copied().unwrap_or_default();
            Game { name, hours, last_played }
        })
        .collect();
    games.sort_by(|a, b| b.last_played.cmp(&a.last_played).then(b.hours.total_cmp(&a.hours)));
    games.truncate(MAX_GAMES);
    games
}

// ---------- Browser history ----------

/// The browsers' history databases: (file, is it Firefox's kind).
fn history_files(home: &Path) -> Vec<(PathBuf, bool)> {
    let _ = home;
    let mut chromium: Vec<PathBuf> = Vec::new(); // "User Data" folders, with Default and Profile N inside
    let mut firefox: Vec<PathBuf> = Vec::new(); // folders with the profiles inside (directly, or in Profiles)
    #[cfg(target_os = "linux")]
    {
        let config = env_dir("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        for d in ["google-chrome", "google-chrome-beta", "chromium", "microsoft-edge", "BraveSoftware/Brave-Browser", "vivaldi", "opera", "thorium"] {
            chromium.push(config.join(d));
        }
        for d in ["snap/chromium/common/chromium", ".var/app/com.google.Chrome/config/google-chrome", ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser", ".var/app/org.chromium.Chromium/config/chromium"] {
            chromium.push(home.join(d));
        }
        // Newer Firefox and Zen keep their profiles in ~/.config.
        for d in ["mozilla/firefox", "zen", "librewolf", "floorp"] {
            firefox.push(config.join(d));
        }
        for d in [".mozilla/firefox", "snap/firefox/common/.mozilla/firefox", ".var/app/org.mozilla.firefox/.mozilla/firefox", ".zen", ".var/app/app.zen_browser.zen/.zen", ".librewolf", ".floorp", ".waterfox"] {
            firefox.push(home.join(d));
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = env_dir("LOCALAPPDATA") {
            for d in [r"Google\Chrome", r"Microsoft\Edge", r"BraveSoftware\Brave-Browser", "Vivaldi", "Chromium", "Thorium"] {
                chromium.push(local.join(d).join("User Data"));
            }
        }
        if let Some(roaming) = env_dir("APPDATA") {
            chromium.push(roaming.join(r"Opera Software\Opera Stable"));
            chromium.push(roaming.join(r"Opera Software\Opera GX Stable"));
            for d in [r"Mozilla\Firefox", "zen", "librewolf", "Floorp", r"Waterfox"] {
                firefox.push(roaming.join(d));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let support = home.join("Library/Application Support");
        for d in ["Google/Chrome", "Microsoft Edge", "BraveSoftware/Brave-Browser", "Vivaldi", "Chromium", "com.operasoftware.Opera", "Arc/User Data"] {
            chromium.push(support.join(d));
        }
        for d in ["Firefox", "zen", "librewolf", "Floorp", "Waterfox"] {
            firefox.push(support.join(d));
        }
    }
    let mut files = Vec::new();
    for dir in chromium {
        // Opera keeps its history right in the folder; the others in a profile folder.
        for p in std::iter::once(dir.clone()).chain(entries(&dir)) {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if (p == dir || name == "Default" || name.starts_with("Profile ")) && p.join("History").is_file() {
                files.push((p.join("History"), false));
            }
        }
    }
    for dir in firefox {
        for p in entries(&dir).into_iter().chain(entries(&dir.join("Profiles"))) {
            // Not the copies profile-sync-daemon leaves next to the real ones.
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if !name.contains("backup") && !name.contains("back-ovfs") && p.join("places.sqlite").is_file() {
                files.push((p.join("places.sqlite"), true));
            }
        }
    }
    files
}

fn sites(home: &Path) -> Vec<(String, u32)> {
    let since = SystemTime::now() - DAY;
    let unix_us = since.duration_since(UNIX_EPOCH).unwrap_or_default().as_micros() as i64;
    let mut visits: HashMap<String, u32> = HashMap::new();
    for (file, is_firefox) in history_files(home) {
        // Not touched in a day: nothing new in it.
        if fs::metadata(&file).and_then(|m| m.modified()).is_ok_and(|t| ago(t) > DAY) && !Path::new(&format!("{}-wal", file.display())).exists() {
            continue;
        }
        let query = if is_firefox {
            // Microseconds since 1970.
            format!("SELECT p.url, COUNT(*) FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id WHERE v.visit_date > {unix_us} GROUP BY p.url")
        } else {
            // Microseconds since 1601.
            let chrome_us = unix_us + 11_644_473_600_000_000;
            format!("SELECT u.url, COUNT(*) FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_time > {chrome_us} GROUP BY u.url")
        };
        for (url, n) in read_copy(&file, &query) {
            if let Some(site) = site(&url) {
                *visits.entry(site).or_default() += n;
            }
        }
    }
    let mut sites: Vec<(String, u32)> = visits.into_iter().collect();
    sites.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    sites.truncate(MAX_SITES);
    sites
}

/// Runs a (url, count) query on a copy of a database the browser has locked open.
/// The copy goes in a new folder only this user can open, and is deleted straight after.
fn read_copy(file: &Path, query: &str) -> Vec<(String, u32)> {
    let Some(dir) = private_dir() else { return Vec::new() };
    let copy = dir.join("history.sqlite");
    let wal = |p: &Path| PathBuf::from(format!("{}-wal", p.display()));
    let mut rows = Vec::new();
    if fs::copy(file, &copy).is_ok() {
        // The newest visits may still be in the write-ahead log.
        let _ = fs::copy(wal(file), wal(&copy));
        if let Ok(db) = rusqlite::Connection::open(&copy) {
            if let Ok(mut stmt) = db.prepare(query) {
                if let Ok(it) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))) {
                    rows.extend(it.flatten());
                }
            }
        }
    }
    let _ = fs::remove_dir_all(&dir);
    rows
}

/// A new, empty folder in the temp folder that only this user can open (it fails rather than reuse one that's already there).
fn private_dir() -> Option<PathBuf> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    for _ in 0..4 {
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
        let dir = std::env::temp_dir().join(format!("verity-snoop-{}-{n}-{nanos:x}", std::process::id()));
        if builder.create(&dir).is_ok() {
            return Some(dir);
        }
    }
    None
}

/// "https://www.youtube.com/watch?v=…" → "youtube.com". Only websites: not files, the browser's own pages or this computer.
fn site(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?.split(':').next()?.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if !host.contains('.') || host.ends_with(".local") || host.parse::<std::net::Ipv4Addr>().is_ok() {
        return None;
    }
    Some(host.to_string())
}

// ---------- Downloads ----------

/// Copies left behind by a run that was killed mid-read (not this run's).
fn remove_leftover_copies() {
    let mine = format!("verity-snoop-{}-", std::process::id());
    for p in entries(&std::env::temp_dir()) {
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name.starts_with("verity-snoop-") && !name.starts_with(&mine) {
            let _ = fs::remove_dir_all(&p);
        }
    }
}

fn downloads_dir(home: &Path) -> PathBuf {
    // Linux: the folder may have another name (in another language); user-dirs.dirs says which.
    #[cfg(target_os = "linux")]
    {
        let config = env_dir("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        if let Ok(src) = fs::read_to_string(config.join("user-dirs.dirs")) {
            for line in src.lines() {
                if let Some(v) = line.trim().strip_prefix("XDG_DOWNLOAD_DIR=") {
                    let v = v.trim_matches('"');
                    let dir = PathBuf::from(v.replace("$HOME", &home.to_string_lossy()));
                    // "$HOME/" means the user turned the folder off: not the whole home folder.
                    if dir.components().ne(home.components()) {
                        return dir;
                    }
                }
            }
        }
    }
    home.join("Downloads")
}

fn downloads(home: &Path) -> Option<Downloads> {
    let dir = downloads_dir(home);
    let files = fs::read_dir(&dir).ok()?;
    let mut total = 0;
    let mut recent: HashMap<String, u32> = HashMap::new();
    for f in files.flatten() {
        let name = f.file_name().to_string_lossy().to_string();
        // Not hidden files, or ones still downloading.
        if name.starts_with('.') || [".part", ".crdownload", ".tmp", ".download"].iter().any(|e| name.ends_with(e)) {
            continue;
        }
        total += 1;
        let Ok(meta) = f.metadata() else { continue };
        let new = meta.created().or_else(|_| meta.modified()).is_ok_and(|t| ago(t) < DAY);
        if new {
            let kind = if meta.is_dir() { "folder".to_string() } else { Path::new(&name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "file".into()) };
            *recent.entry(kind).or_default() += 1;
        }
    }
    let mut recent: Vec<(String, u32)> = recent.into_iter().collect();
    recent.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Some(Downloads { total, recent })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_from_urls() {
        assert_eq!(site("https://www.youtube.com/watch?v=x").as_deref(), Some("youtube.com"));
        assert_eq!(site("http://user@Example.org:8080/a").as_deref(), Some("example.org"));
        assert_eq!(site("file:///home/me/a.html"), None);
        assert_eq!(site("http://localhost:1420/"), None);
        assert_eq!(site("http://192.168.0.1/"), None);
        assert_eq!(site("chrome://settings"), None);
    }

    #[test]
    fn desktop_names() {
        assert_eq!(desktop_name("[Desktop Entry]\nType=Application\nName=Blender\nName[de]=Blender\n").as_deref(), Some("Blender"));
        assert_eq!(desktop_name("[Desktop Entry]\nName=Hidden\nNoDisplay=true\n"), None);
        assert_eq!(desktop_name("[Desktop Entry]\nName=Firefox\n[Desktop Action new]\nName=New Window\n").as_deref(), Some("Firefox"));
    }

    #[test]
    fn vdf() {
        let v = Vdf::parse("\"AppState\"\n{\n\t\"appid\"\t\t\"620\"\n\t\"name\"\t\t\"Portal 2\"\n\t\"x\" { \"y\" \"z\" }\n}\n");
        assert_eq!(v.path(&["AppState", "appid"]).and_then(Vdf::str), Some("620"));
        assert_eq!(v.path(&["appstate", "NAME"]).and_then(Vdf::str), Some("Portal 2"));
        assert_eq!(v.path(&["AppState", "x", "y"]).and_then(Vdf::str), Some("z"));
    }
}

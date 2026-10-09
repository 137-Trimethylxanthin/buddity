//! Where the other apps' windows are, so Verity can stand on them, go into
//! them and know which app he's next to. Only the app's name and the window's
//! rectangle are read, never its title. A thread polls and sends the list to
//! the character window as an "app-windows" event when it changes.
//!
//! Hyprland (its IPC socket), X11 (EWMH), Windows and macOS. Other Wayland
//! desktops (GNOME, KDE, Sway) don't tell apps where windows are: empty list.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Off until the window says the "windows" setting is on.
static ENABLED: AtomicBool = AtomicBool::new(false);
/// While he stands on a window: check every frame, so he moves with it smoothly when it's dragged.
static FAST: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct AppWindow {
    /// Stays the same while the window exists (it may move).
    pub id: String,
    /// The app, e.g. "Spotify", "firefox". Never the title.
    pub app: String,
    /// Physical pixels on the desktop.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
}

pub fn set_fast(on: bool) {
    FAST.store(on, Ordering::SeqCst);
}

/// Polls forever; the list is front to back (the first window is on top).
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        // macOS asks through osascript, which is slow; elsewhere it's a cheap query.
        let (slow, fast) = if cfg!(target_os = "macos") { (1000, 250) } else { (300, 16) };
        let mut last: Option<Vec<AppWindow>> = None;
        // Something moved recently (a window being dragged): keep checking every frame for a while,
        // so a window swung into him is noticed on the way, not after it's already past.
        let mut changed_at = std::time::Instant::now() - Duration::from_secs(10);
        loop {
            let busy = changed_at.elapsed() < Duration::from_secs(1);
            let ms = if FAST.load(Ordering::SeqCst) || busy { fast } else { slow };
            std::thread::sleep(Duration::from_millis(ms));
            if !ENABLED.load(Ordering::SeqCst) {
                last = None;
                continue;
            }
            let list = platform::list(std::process::id());
            if last.as_ref() != Some(&list) {
                changed_at = std::time::Instant::now();
                let _ = app.emit("app-windows", &list);
                last = Some(list);
            }
        }
    });
}

/// Per-screen bottom of the usable area (above bars/docks), physical y, by
/// screen position; None where the platform's own work area is right.
pub fn screen_floor(x: i32, y: i32) -> Option<f64> {
    #[cfg(target_os = "linux")]
    if let Some(f) = hyprland::floor(x, y) {
        return Some(f);
    }
    let _ = (x, y);
    None
}

#[cfg(target_os = "linux")]
mod hyprland {
    use super::AppWindow;
    use serde_json::Value;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;

    fn socket() -> Option<std::path::PathBuf> {
        let sig = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
        let runtime = std::env::var("XDG_RUNTIME_DIR").unwrap_or_default();
        [format!("{runtime}/hypr/{sig}/.socket.sock"), format!("/tmp/hypr/{sig}/.socket.sock")]
            .into_iter()
            .map(std::path::PathBuf::from)
            .find(|p| p.exists())
    }

    /// One request on Hyprland's IPC socket ("j/clients", "j/monitors").
    fn ask(what: &str) -> Option<Value> {
        let mut s = UnixStream::connect(socket()?).ok()?;
        s.set_read_timeout(Some(std::time::Duration::from_millis(500))).ok()?;
        s.write_all(what.as_bytes()).ok()?;
        let mut out = Vec::new();
        s.read_to_end(&mut out).ok()?;
        serde_json::from_slice(&out).ok()
    }

    pub fn running() -> bool {
        socket().is_some()
    }

    struct Monitor {
        id: i64,
        x: f64,
        y: f64,
        h: f64,
        scale: f64,
        workspace: i64,
        special: i64,
        reserved_bottom: f64,
    }

    /// Monitors change rarely; asked at most once a second (windows are asked every frame while he's on one).
    fn monitors() -> Vec<Monitor> {
        static CACHE: std::sync::Mutex<Option<(std::time::Instant, Value)>> = std::sync::Mutex::new(None);
        let lock = || CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let mut cached = lock().clone();
        // Not holding the lock while asking: a slow socket would stall the other callers.
        if !cached.as_ref().is_some_and(|(at, _)| at.elapsed() < std::time::Duration::from_secs(1)) {
            if let Some(v) = ask("j/monitors") {
                cached = Some((std::time::Instant::now(), v));
                *lock() = cached.clone();
            }
        }
        let Some((_, Value::Array(list))) = cached else { return Vec::new() };
        list.iter()
            .map(|m| Monitor {
                id: m["id"].as_i64().unwrap_or(-1),
                x: m["x"].as_f64().unwrap_or(0.0),
                y: m["y"].as_f64().unwrap_or(0.0),
                // width/height are before the transform: rotated by 90° or 270° (odd), they swap.
                h: m[if m["transform"].as_i64().unwrap_or(0) % 2 == 1 { "width" } else { "height" }].as_f64().unwrap_or(0.0)
                    / m["scale"].as_f64().unwrap_or(1.0),
                scale: m["scale"].as_f64().unwrap_or(1.0),
                workspace: m["activeWorkspace"]["id"].as_i64().unwrap_or(i64::MIN),
                special: m["specialWorkspace"]["id"].as_i64().unwrap_or(0),
                reserved_bottom: m["reserved"][3].as_f64().unwrap_or(0.0),
            })
            .collect()
    }

    /// The bottom of the usable area of the screen at that (physical) position.
    pub fn floor(x: i32, y: i32) -> Option<f64> {
        if !running() {
            return None;
        }
        let m = monitors().into_iter().find(|m| (m.x * m.scale - x as f64).abs() < 2.0 && (m.y * m.scale - y as f64).abs() < 2.0)?;
        Some((m.y + m.h - m.reserved_bottom) * m.scale)
    }

    pub fn list(me: u32) -> Option<Vec<AppWindow>> {
        let mons = monitors();
        let Value::Array(clients) = ask("j/clients")? else { return None };
        let truthy = |v: &Value| v.as_bool().unwrap_or_else(|| v.as_i64().unwrap_or(0) != 0); // bool or int, by version
        let mut shown: Vec<(&Value, &Monitor)> = clients
            .iter()
            .filter(|c| c["pid"].as_u64() != Some(me as u64) && truthy(&c["mapped"]) && !truthy(&c["hidden"]))
            .filter_map(|c| {
                let mon = mons.iter().find(|m| m.id == c["monitor"].as_i64().unwrap_or(-2))?;
                let ws = c["workspace"]["id"].as_i64().unwrap_or(i64::MIN);
                let visible = truthy(&c["pinned"]) || ws == mon.workspace || (mon.special != 0 && ws == mon.special);
                visible.then_some((c, mon))
            })
            .collect();
        // Front to back: fullscreen, then floating/pinned, then tiled; most recently focused first.
        shown.sort_by_key(|(c, _)| {
            let layer = if truthy(&c["fullscreen"]) { 0 } else if truthy(&c["floating"]) || truthy(&c["pinned"]) { 1 } else { 2 };
            (layer, c["focusHistoryID"].as_i64().unwrap_or(i64::MAX))
        });
        Some(
            shown
                .into_iter()
                .map(|(c, m)| AppWindow {
                    id: c["address"].as_str().unwrap_or_default().to_string(),
                    app: c["class"].as_str().unwrap_or_default().to_string(),
                    x: c["at"][0].as_f64().unwrap_or(0.0) * m.scale,
                    y: c["at"][1].as_f64().unwrap_or(0.0) * m.scale,
                    w: c["size"][0].as_f64().unwrap_or(0.0) * m.scale,
                    h: c["size"][1].as_f64().unwrap_or(0.0) * m.scale,
                })
                .collect(),
        )
    }
}

#[cfg(target_os = "linux")]
mod x11 {
    use super::AppWindow;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, Window};
    use x11rb::rust_connection::RustConnection;

    /// The connection and atoms, kept across polls (it's polled every frame at times).
    struct X {
        conn: RustConnection,
        root: Window,
        stacking: u32,
        desktop: u32,
        current: u32,
        state: u32,
        hidden: u32,
        pid: u32,
        extents: u32,
    }

    impl X {
        fn connect() -> Option<Self> {
            let (conn, screen) = x11rb::connect(None).ok()?;
            let root = conn.setup().roots[screen].root;
            let atom = |name: &str| conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok().map(|r| r.atom);
            Some(Self {
                root,
                stacking: atom("_NET_CLIENT_LIST_STACKING")?,
                desktop: atom("_NET_WM_DESKTOP")?,
                current: atom("_NET_CURRENT_DESKTOP")?,
                state: atom("_NET_WM_STATE")?,
                hidden: atom("_NET_WM_STATE_HIDDEN")?,
                pid: atom("_NET_WM_PID")?,
                extents: atom("_NET_FRAME_EXTENTS")?,
                conn,
            })
        }
    }

    /// Reconnects on the next poll after a failure (e.g. the X server restarted).
    pub fn list(me: u32) -> Option<Vec<AppWindow>> {
        static CONN: std::sync::Mutex<Option<X>> = std::sync::Mutex::new(None);
        let mut held = CONN.lock().unwrap_or_else(|e| e.into_inner());
        if held.is_none() {
            *held = X::connect();
        }
        let out = read(held.as_ref()?, me);
        if out.is_none() {
            *held = None;
        }
        out
    }

    fn read(x: &X, me: u32) -> Option<Vec<AppWindow>> {
        let X { ref conn, root, stacking, desktop, current, state, hidden, pid, extents } = *x;
        // Length is in 32-bit units: small for a window's own properties, unlimited for the client list.
        let read32 = |win: Window, prop: u32, len: u32| -> Option<Vec<u32>> {
            let r = conn.get_property(false, win, prop, AtomEnum::ANY, 0, len).ok()?.reply().ok()?;
            let values: Vec<u32> = r.value32()?.collect();
            Some(values)
        };
        let cardinals = |win: Window, prop: u32| read32(win, prop, 64);
        let now = cardinals(root, current).and_then(|d| d.first().copied());
        let mut out = Vec::new();
        // The stacking list is bottom to top.
        for win in read32(root, stacking, u32::MAX / 4)?.into_iter().rev() {
            if cardinals(win, pid).and_then(|p| p.first().copied()) == Some(me) {
                continue;
            }
            let on = cardinals(win, desktop).and_then(|d| d.first().copied());
            if matches!((on, now), (Some(d), Some(n)) if d != n && d != 0xFFFF_FFFF) {
                continue; // on another workspace
            }
            if cardinals(win, state).is_some_and(|s| s.contains(&hidden)) {
                continue; // minimised
            }
            let Some(geo) = conn.get_geometry(win).ok().and_then(|c| c.reply().ok()) else { continue };
            let Some(pos) = conn.translate_coordinates(win, root, 0, 0).ok().and_then(|c| c.reply().ok()) else { continue };
            // Include the title bar and borders the window manager draws.
            let e = cardinals(win, extents).unwrap_or_default();
            let (l, r, t, b) = (e.first(), e.get(1), e.get(2), e.get(3));
            let (l, r, t, b) = (*l.unwrap_or(&0) as f64, *r.unwrap_or(&0) as f64, *t.unwrap_or(&0) as f64, *b.unwrap_or(&0) as f64);
            let class = conn
                .get_property(false, win, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)
                .ok()
                .and_then(|c| c.reply().ok())
                .map(|r| {
                    // "instance\0Class\0": the class is the nicer name.
                    let parts: Vec<String> = r.value.split(|b| *b == 0).map(|p| String::from_utf8_lossy(p).into_owned()).collect();
                    parts.get(1).filter(|c| !c.is_empty()).or(parts.first()).cloned().unwrap_or_default()
                })
                .unwrap_or_default();
            out.push(AppWindow {
                id: win.to_string(),
                app: class,
                x: pos.dst_x as f64 - l,
                y: pos.dst_y as f64 - t,
                w: geo.width as f64 + l + r,
                h: geo.height as f64 + t + b,
            });
        }
        Some(out)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::AppWindow;

    pub fn list(me: u32) -> Vec<AppWindow> {
        if super::hyprland::running() {
            return super::hyprland::list(me).unwrap_or_default();
        }
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Vec::new(); // GNOME/KDE/Sway: X11 would only show XWayland apps
        }
        super::x11::list(me).unwrap_or_default()
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::AppWindow;
    use std::collections::HashMap;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    struct Found {
        me: u32,
        out: Vec<AppWindow>,
        /// App names by pid from the last poll, and this poll's (only pids still showing windows are kept).
        names: HashMap<u32, String>,
        seen: HashMap<u32, String>,
    }

    /// Kept across polls: asking a process for its name every frame is slow.
    static NAMES: std::sync::Mutex<Option<HashMap<u32, String>>> = std::sync::Mutex::new(None);

    fn process_name(pid: u32) -> String {
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return String::new();
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let file = path.rsplit('\\').next().unwrap_or(&path);
            file.trim_end_matches(".exe").trim_end_matches(".EXE").to_string()
        }
    }

    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let found = &mut *(data.0 as *mut Found);
        // Real app windows: visible, not minimised, not hidden by the system (cloaked), not tool windows.
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return true.into();
        }
        if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0 {
            return true.into();
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4);
        if cloaked != 0 {
            return true.into();
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == found.me {
            return true.into();
        }
        let mut r = RECT::default();
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
            return true.into();
        }
        let Found { names, seen, .. } = &mut *found;
        let app = match seen.get(&pid) {
            Some(name) => name.clone(),
            None => {
                let name = names.remove(&pid).unwrap_or_else(|| process_name(pid));
                if !name.is_empty() {
                    seen.insert(pid, name.clone()); // a failed lookup is tried again next time
                }
                name
            }
        };
        found.out.push(AppWindow {
            id: format!("{:x}", hwnd.0 as usize),
            app,
            x: r.left as f64,
            y: r.top as f64,
            w: (r.right - r.left) as f64,
            h: (r.bottom - r.top) as f64,
        });
        true.into()
    }

    /// EnumWindows goes front to back.
    pub fn list(me: u32) -> Vec<AppWindow> {
        let names = NAMES.lock().unwrap_or_else(|e| e.into_inner()).take().unwrap_or_default();
        let mut found = Found { me, out: Vec::new(), names, seen: HashMap::new() };
        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut Found as isize));
        }
        *NAMES.lock().unwrap_or_else(|e| e.into_inner()) = Some(found.seen);
        found.out
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::AppWindow;
    use std::process::Command;

    /// Window owners and bounds (in points) need no screen-recording permission; titles would.
    const SCRIPT: &str = r#"
ObjC.import('CoreGraphics');
function run() {
  const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || [];
  return JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0).map((w) => [
    String(w.kCGWindowNumber), w.kCGWindowOwnerName || "", w.kCGWindowOwnerPID,
    w.kCGWindowBounds.X, w.kCGWindowBounds.Y, w.kCGWindowBounds.Width, w.kCGWindowBounds.Height,
  ]));
}"#;

    /// Front to back. Points are scaled by the main screen's factor (mixed-DPI setups may be off).
    pub fn list(me: u32) -> Vec<AppWindow> {
        let Ok(out) = Command::new("osascript").args(["-l", "JavaScript", "-e", SCRIPT]).output() else { return Vec::new() };
        let Ok(rows) = serde_json::from_slice::<Vec<(String, String, u32, f64, f64, f64, f64)>>(&out.stdout) else { return Vec::new() };
        let scale = SCALE.get_or_init(main_scale);
        rows.into_iter()
            .filter(|r| r.2 != me)
            .map(|(id, app, _, x, y, w, h)| AppWindow { id, app, x: x * scale, y: y * scale, w: w * scale, h: h * scale })
            .collect()
    }

    static SCALE: std::sync::OnceLock<f64> = std::sync::OnceLock::new();

    fn main_scale() -> f64 {
        let out = Command::new("osascript")
            .args(["-l", "JavaScript", "-e", "ObjC.import('AppKit'); $.NSScreen.mainScreen.backingScaleFactor"])
            .output();
        out.ok().and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok()).unwrap_or(1.0)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
mod platform {
    pub fn list(_me: u32) -> Vec<super::AppWindow> {
        Vec::new()
    }
}

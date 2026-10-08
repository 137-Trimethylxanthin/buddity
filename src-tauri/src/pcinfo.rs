//! Harmless facts about the computer for Verity to bring up: the OS, the CPU and
//! how busy it is, RAM, which app uses the most memory, and the battery.
//! Only names and numbers; never window titles, files or anything from the network.

use std::collections::HashMap;
use std::sync::Mutex;

use sysinfo::{ProcessesToUpdate, System};

#[derive(Clone, serde::Serialize)]
pub struct PcInfo {
    /// e.g. "Windows 11", "CachyOS Linux".
    os: String,
    cpu: String,
    cores: usize,
    /// Average CPU load (%) since the last time he asked.
    cpu_load: f32,
    ram_used_gb: f64,
    ram_total_gb: f64,
    /// The app using the most memory (its processes added up) and how much, in GB.
    top_app: Option<(String, f64)>,
    /// Charge in %, and whether it's charging. None without a battery.
    battery: Option<(f32, bool)>,
}

/// Keeps the System between calls, so CPU load can be measured from one call to the next.
pub struct Pc(Mutex<System>);

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

impl Pc {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        Self(Mutex::new(sys))
    }

    pub fn info(&self) -> PcInfo {
        let mut sys = self.0.lock().unwrap_or_else(|e| e.into_inner());
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        PcInfo {
            // Linux: the distro ("CachyOS Linux"); elsewhere the version ("Windows 11 Pro").
            os: if cfg!(target_os = "linux") { System::name() } else { System::long_os_version() }.unwrap_or_default(),
            cpu: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            cores: sys.cpus().len(),
            cpu_load: sys.global_cpu_usage(),
            ram_used_gb: sys.used_memory() as f64 / GB,
            ram_total_gb: sys.total_memory() as f64 / GB,
            top_app: top_app(&sys),
            battery: battery(),
        }
    }
}

/// Adds up memory per app (browsers run many processes) and returns the biggest.
fn top_app(sys: &System) -> Option<(String, f64)> {
    let me = std::process::id();
    let mut per_app: HashMap<String, u64> = HashMap::new();
    for (pid, p) in sys.processes() {
        // Threads are listed too (on Linux), each with the whole process's memory.
        if pid.as_u32() == me || p.thread_kind().is_some() {
            continue;
        }
        // The executable's name groups helper processes (Linux cuts process names to 15 characters).
        let name = p
            .exe()
            .and_then(|e| e.file_stem())
            .unwrap_or_else(|| p.name())
            .to_string_lossy()
            .trim_end_matches(".exe")
            .to_string();
        if name.is_empty() || name.eq_ignore_ascii_case("verity") {
            continue;
        }
        *per_app.entry(name).or_default() += p.memory();
    }
    // Shared memory is counted once per process, so cap it at what's actually in use.
    per_app
        .into_iter()
        .max_by_key(|(_, mem)| *mem)
        .map(|(name, mem)| (pretty(&name), mem.min(sys.used_memory()) as f64 / GB))
}

/// "firefox" → "Firefox", "zen-bin" → "Zen".
fn pretty(name: &str) -> String {
    let name = name.trim_end_matches("-bin").trim_end_matches("-browser");
    let mut c = name.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

fn battery() -> Option<(f32, bool)> {
    let manager = starship_battery::Manager::new().ok()?;
    let b = manager.batteries().ok()?.flatten().next()?;
    let charging = matches!(b.state(), starship_battery::State::Charging | starship_battery::State::Full);
    Some((b.state_of_charge().value * 100.0, charging))
}

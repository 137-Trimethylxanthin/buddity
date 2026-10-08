mod discord;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// A rectangle in logical (CSS) pixels, relative to the window's top-left corner.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

/// The parts of the window that should receive clicks (the face, the speech bubble).
/// Everything else is click-through.
#[derive(Default)]
struct HitRegions(Mutex<Vec<Rect>>);

#[tauri::command]
fn set_hit_regions(window: WebviewWindow, regions: tauri::State<HitRegions>, rects: Vec<Rect>) {
    *regions.0.lock().unwrap() = rects.clone();
    #[cfg(target_os = "linux")]
    linux::apply_input_shape(&window, rects);
    #[cfg(not(target_os = "linux"))]
    let _ = window;
}

/// Local only: used for the "creepy" lines. Never leaves the machine.
#[tauri::command]
fn get_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "friend".into())
}

/// Local only, for the "creepy" lines: how long the computer has been on, in seconds.
#[tauri::command]
fn get_uptime() -> Option<u64> {
    // uptime_lib can panic on macOS if the clock was set back before boot time.
    std::panic::catch_unwind(uptime_lib::get).ok()?.ok().map(|d| d.as_secs())
}

/// Chance that Quit in the tray only pretends to quit.
const FAKE_QUIT_CHANCE: f64 = 0.02;
/// He comes back this many seconds later.
const FAKE_QUIT_SECS: u64 = 60;

/// Set while Verity is pretending to have quit.
static AWAY: AtomicBool = AtomicBool::new(false);
/// Counts fake quits, so a timer from an earlier one can't bring him back early.
static AWAY_ROUND: AtomicU64 = AtomicU64::new(0);

/// A number in [0, 1). Good enough for a prank; not worth a dependency.
fn roll() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos.wrapping_mul(2_654_435_761) % 1_000_000) as f64 / 1_000_000.0
}

/// Quit from the tray. Usually real; sometimes Verity only pretends: he and the
/// tray icon disappear, and he comes back angry a minute later.
/// The timer lives here, not in the webview, so it can't be throttled away.
/// VERITY_FAKE_QUIT_CHANCE / VERITY_FAKE_QUIT_SECS override both, for testing.
fn quit(app: &AppHandle) {
    let env = |name: &str| std::env::var(name).ok().and_then(|v| v.parse::<f64>().ok());
    let chance = env("VERITY_FAKE_QUIT_CHANCE").unwrap_or(FAKE_QUIT_CHANCE);
    if roll() >= chance {
        app.exit(0);
        return;
    }
    let away = env("VERITY_FAKE_QUIT_SECS").map(|s| s as u64).unwrap_or(FAKE_QUIT_SECS);
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.close();
    }
    let round = AWAY_ROUND.fetch_add(1, Ordering::SeqCst) + 1;
    AWAY.store(true, Ordering::SeqCst);
    let _ = app.emit("fake-quit", ());
    if let Some(tray) = app.tray_by_id("verity") {
        let _ = tray.set_visible(false);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(away));
        if AWAY_ROUND.load(Ordering::SeqCst) == round {
            come_back(&app);
        }
    });
}

/// Ends a fake quit: the tray icon reappears and he crashes out.
fn come_back(app: &AppHandle) {
    if !AWAY.swap(false, Ordering::SeqCst) {
        return;
    }
    if let Some(tray) = app.tray_by_id("verity") {
        let _ = tray.set_visible(true);
    }
    let _ = app.emit("came-back", ());
}

/// Opens a connection for simulating mouse input (moving the cursor, scrolling).
fn input() -> Result<enigo::Enigo, String> {
    #[cfg(target_os = "linux")]
    {
        // enigo sends every event through each backend it connects to, so under
        // Wayland keep it off XWayland or every nudge happens twice. Compositors
        // without the virtual-pointer protocol (GNOME) fall back to X11.
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            let wayland_only = enigo::Settings {
                x11_display: Some(":verity-no-x11".into()),
                ..Default::default()
            };
            if let Ok(con) = enigo::Enigo::new(&wayland_only) {
                return Ok(con);
            }
        }
    }
    enigo::Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())
}

enum InputCmd {
    MoveTo(i32, i32),
    Scroll(i32),
}

/// Mouse input goes through one long-lived connection on its own thread, so
/// pinning the cursor to him every frame stays cheap. A failed connection is
/// retried on the next command.
struct Input(Mutex<std::sync::mpsc::Sender<InputCmd>>);

impl Input {
    fn spawn() -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<InputCmd>();
        std::thread::spawn(move || {
            use enigo::Mouse;
            let mut con: Option<enigo::Enigo> = None;
            for cmd in rx {
                if con.is_none() {
                    con = input().ok();
                }
                let Some(c) = con.as_mut() else { continue };
                let done = match cmd {
                    InputCmd::MoveTo(x, y) => c.move_mouse(x, y, enigo::Coordinate::Abs),
                    InputCmd::Scroll(lines) => c.scroll(lines, enigo::Axis::Vertical),
                };
                if done.is_err() {
                    con = None;
                }
            }
        });
        Self(Mutex::new(tx))
    }

    fn send(&self, cmd: InputCmd) {
        let _ = self.0.lock().unwrap().send(cmd);
    }
}

/// Puts the system cursor on a point of the window, in logical (CSS) pixels.
#[tauri::command]
fn cursor_to(window: WebviewWindow, input: tauri::State<Input>, x: f64, y: f64) -> Result<(), String> {
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    // macOS places the cursor in points (logical pixels); Windows and Linux in physical pixels.
    #[cfg(target_os = "macos")]
    let (ax, ay) = {
        let o = origin.to_logical::<f64>(scale);
        ((o.x + x) as i32, (o.y + y) as i32)
    };
    #[cfg(not(target_os = "macos"))]
    let (ax, ay) = (origin.x + (x * scale) as i32, origin.y + (y * scale) as i32);
    input.send(InputCmd::MoveTo(ax, ay));
    Ok(())
}

/// Sets Verity's Discord status, or clears it with None.
#[tauri::command]
fn discord_status(discord: tauri::State<discord::Discord>, status: Option<discord::Status>) {
    discord.set(status);
}

/// Opens the settings window, or brings it to the front if it's already open.
/// Async: creating a window from a sync command can deadlock on Windows.
#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("settings") {
        return win.set_focus();
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Verity settings")
        .inner_size(360.0, 640.0)
        .resizable(false)
        .build()
        .map(|_| ())
}

/// Scrolls whatever window is under the cursor (positive = down).
#[tauri::command]
fn scroll_active(input: tauri::State<Input>, lines: i32) {
    input.send(InputCmd::Scroll(lines));
}

#[cfg(target_os = "linux")]
mod linux {
    use gtk::cairo::{RectangleInt, Region};
    use gtk::prelude::*;

    /// Linux has no reliable global cursor on Wayland, so instead of toggling
    /// click-through we shape the window's input region to the visible parts.
    /// This works on both X11 and Wayland.
    pub fn apply_input_shape(window: &tauri::WebviewWindow, rects: Vec<super::Rect>) {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(gtk_window) = win.gtk_window() else { return };
            let region = Region::create();
            for r in &rects {
                let _ = region.union_rectangle(&RectangleInt::new(
                    r.x.floor() as i32,
                    r.y.floor() as i32,
                    r.w.ceil() as i32,
                    r.h.ceil() as i32,
                ));
            }
            gtk_window.input_shape_combine_region(Some(&region));
        });
    }

    /// On Wayland compositors with wlr-layer-shell (Hyprland, KDE, Sway) turn the
    /// window into an overlay layer: it covers the screen above normal windows, is
    /// on every workspace and never takes keyboard focus. Plain Wayland windows
    /// can't be positioned or kept on top by the app itself.
    /// Returns false where layer-shell isn't available (X11, GNOME).
    pub fn try_layer_shell(window: &tauri::WebviewWindow) -> bool {
        use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

        if !gtk_layer_shell::is_supported() {
            return false;
        }
        let Ok(gtk_window) = window.gtk_window() else { return false };
        // Layer-shell has to be set up before the window is mapped.
        gtk_window.hide();
        gtk_window.unrealize();
        gtk_window.init_layer_shell();
        gtk_window.set_namespace("verity");
        gtk_window.set_layer(Layer::Overlay);
        for edge in [Edge::Left, Edge::Right, Edge::Top, Edge::Bottom] {
            gtk_window.set_anchor(edge, true);
        }
        gtk_window.set_exclusive_zone(0);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        gtk_window.show();
        true
    }
}

/// Polls the global cursor so the eyes can follow it anywhere on screen, and on
/// Windows/macOS toggles click-through when the cursor enters or leaves a hit region.
fn spawn_cursor_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_pos: Option<(f64, f64)> = None;
        #[cfg(not(target_os = "linux"))]
        let mut last_ignore: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let Some(win) = app.get_webview_window("main") else { continue };
            let Ok(cursor) = app.cursor_position() else { continue };
            let (Ok(origin), Ok(scale)) = (win.inner_position(), win.scale_factor()) else {
                continue;
            };
            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;

            if last_pos != Some((x, y)) {
                last_pos = Some((x, y));
                let _ = win.emit("cursor", (x, y));
            }

            #[cfg(not(target_os = "linux"))]
            {
                let inside = app.state::<HitRegions>().0.lock().unwrap().iter().any(|r| r.contains(x, y));
                if last_ignore != Some(!inside) {
                    last_ignore = Some(!inside);
                    let _ = win.set_ignore_cursor_events(!inside);
                }
            }
        }
    });
}

/// Stretches the transparent window over the monitor's work area so Verity can
/// roam the whole desktop. Clicks pass through everywhere except her body.
fn cover_screen(win: &WebviewWindow) {
    let Ok(Some(monitor)) = win.primary_monitor() else { return };
    let area = monitor.work_area();
    let _ = win.set_position(PhysicalPosition::new(area.position.x, area.position.y));
    let _ = win.set_size(PhysicalSize::new(area.size.width, area.size.height));
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let skins = Submenu::with_items(
        app,
        "Skin",
        true,
        &[
            &MenuItem::with_id(app, "skin:verity", "Verity", true, None::<&str>)?,
            &MenuItem::with_id(app, "skin:falsity", "Falsity", true, None::<&str>)?,
            &MenuItem::with_id(app, "skin:lovity", "Lovity", true, None::<&str>)?,
            &MenuItem::with_id(app, "skin:obesity", "Obesity", true, None::<&str>)?,
            &MenuItem::with_id(app, "skin:freakity", "Freakity", true, None::<&str>)?,
            &MenuItem::with_id(app, "skin:goonity", "Goonity", true, None::<&str>)?,
        ],
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "talk", "Say something", true, None::<&str>)?,
            &MenuItem::with_id(app, "sing", "Sing a song", true, None::<&str>)?,
            &MenuItem::with_id(app, "creepy", "Toggle creepy mode", true, None::<&str>)?,
            &skins,
            &MenuItem::with_id(app, "recall", "Call Verity back", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("verity")
        .icon(app.default_window_icon().cloned().expect("bundle icon missing"))
        .tooltip("Verity")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => quit(app),
            "settings" => {
                // Not from inside the event handler: building a window there can deadlock on Windows.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_settings(&app);
                });
            }
            id => {
                let _ = app.emit("tray", id);
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching him again while he's pretending to be gone makes him come back now.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| come_back(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(HitRegions::default())
        .manage(Input::spawn())
        .manage(discord::Discord::spawn())
        .invoke_handler(tauri::generate_handler![set_hit_regions, get_username, get_uptime, cursor_to, discord_status, open_settings, scroll_active])
        .setup(|app| {
            build_tray(app)?;
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(target_os = "linux")]
                let layered = linux::try_layer_shell(&win);
                #[cfg(not(target_os = "linux"))]
                let layered = false;
                if !layered {
                    cover_screen(&win);
                }
            }
            spawn_cursor_poll(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Verity");
}

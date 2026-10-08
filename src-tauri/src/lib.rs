use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

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

/// Opens a connection for simulating mouse input (nudging the cursor, scrolling).
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

/// Moves the system cursor by (dx, dy) pixels, to get the user's attention.
#[tauri::command]
async fn nudge_cursor(dx: i32, dy: i32) -> Result<(), String> {
    use enigo::Mouse;
    input()?.move_mouse(dx, dy, enigo::Coordinate::Rel).map_err(|e| e.to_string())
}

/// Scrolls whatever window is under the cursor (positive = down).
#[tauri::command]
async fn scroll_active(lines: i32) -> Result<(), String> {
    use enigo::Mouse;
    input()?.scroll(lines, enigo::Axis::Vertical).map_err(|e| e.to_string())
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
            &MenuItem::with_id(app, "sound", "Sound on/off", true, None::<&str>)?,
            &MenuItem::with_id(app, "recall", "Call Verity back", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("verity")
        .icon(app.default_window_icon().cloned().expect("bundle icon missing"))
        .tooltip("Verity")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(HitRegions::default())
        .invoke_handler(tauri::generate_handler![set_hit_regions, get_username, nudge_cursor, scroll_active])
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

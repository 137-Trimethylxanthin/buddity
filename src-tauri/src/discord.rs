//! Discord Rich Presence: shows "Verity" in the user's Discord status.
//! A background thread owns the connection and keeps trying to (re)connect, so
//! Discord can be started, quit or restarted while Verity runs.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{Activity, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

/// The Discord application Verity shows up as (discord.com/developers/applications).
/// VERITY_DISCORD_APP_ID overrides it. Empty turns Rich Presence off.
const APP_ID: &str = "1557831767266697276";
const RETRY: Duration = Duration::from_secs(15);
const IMAGE: &str = "https://raw.githubusercontent.com/137-Trimethylxanthin/buddity/main/src-tauri/icons/128x128%402x.png";
const DOWNLOAD: &str = "https://github.com/137-Trimethylxanthin/buddity/releases/latest";

/// What the status says, or None for no status.
#[derive(Clone, PartialEq, serde::Deserialize)]
pub struct Status {
    details: String,
    state: String,
}

pub struct Discord(Mutex<Sender<Option<Status>>>);

impl Discord {
    pub fn spawn() -> Self {
        let (tx, rx) = channel::<Option<Status>>();
        let app_id = std::env::var("VERITY_DISCORD_APP_ID").unwrap_or_else(|_| APP_ID.into());
        std::thread::spawn(move || {
            if app_id.is_empty() {
                for _ in rx {} // nothing to show without an application
                return;
            }
            let started = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            let mut client: Option<DiscordIpcClient> = None;
            let mut wanted: Option<Status> = None;
            let mut shown: Option<Status> = None;
            loop {
                match rx.recv_timeout(RETRY) {
                    Ok(status) => wanted = status,
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if wanted == shown && client.is_some() {
                    continue;
                }
                if client.is_none() {
                    let mut c = DiscordIpcClient::new(&app_id);
                    if c.connect().is_err() {
                        continue; // Discord isn't running; try again later
                    }
                    client = Some(c);
                    shown = None;
                }
                let c = client.as_mut().unwrap();
                let sent = match &wanted {
                    Some(s) => c.set_activity(
                        Activity::new()
                            .details(&s.details)
                            .state(&s.state)
                            .timestamps(Timestamps::new().start(started))
                            .assets(Assets::new().large_image(IMAGE).large_text("Verity"))
                            .buttons(vec![Button::new("Get Verity", DOWNLOAD)]),
                    ),
                    None => c.clear_activity(),
                };
                if sent.is_ok() {
                    shown = wanted.clone();
                } else {
                    let _ = c.close();
                    client = None; // Discord went away; reconnect next round
                }
            }
            if let Some(mut c) = client {
                let _ = c.close();
            }
        });
        Self(Mutex::new(tx))
    }

    pub fn set(&self, status: Option<Status>) {
        let _ = self.0.lock().unwrap().send(status);
    }
}

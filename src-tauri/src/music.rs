//! What music is playing (Spotify, a browser tab, any media player), so Verity
//! can dance and sing along. A background thread asks the system every couple of
//! seconds and sends the result to the window as a "music" event:
//! Linux uses MPRIS (D-Bus), Windows the system media controls (GSMTC), macOS
//! asks Spotify and Music through osascript. Nothing leaves the computer here.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_secs(2);

/// Off until the window says the "music" setting is on.
static ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds, if the player says.
    pub duration: Option<f64>,
    /// Seconds into the track when this was read, if the player says.
    pub position: Option<f64>,
    pub playing: bool,
    /// The app playing it, e.g. "Spotify".
    pub player: String,
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
}

/// Polls forever; sends Some(track) while something is loaded, None when nothing is.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut reader = platform::Reader::new();
        let mut last_sent_none = false;
        loop {
            std::thread::sleep(POLL);
            if !ENABLED.load(Ordering::SeqCst) {
                continue;
            }
            let track = reader.now_playing().filter(|t| !t.title.is_empty());
            // Nothing playing is sent once, not every poll.
            if track.is_none() && last_sent_none {
                continue;
            }
            last_sent_none = track.is_none();
            let _ = app.emit("music", track);
        }
    });
}

#[cfg(target_os = "linux")]
mod platform {
    use super::Track;
    use mpris::{PlaybackStatus, PlayerFinder};

    pub struct Reader(Option<PlayerFinder>);

    impl Reader {
        pub fn new() -> Self {
            Self(None)
        }

        pub fn now_playing(&mut self) -> Option<Track> {
            if self.0.is_none() {
                self.0 = PlayerFinder::new().ok(); // no session bus: try again next time
            }
            // find_active prefers a player that's playing, then one that's paused.
            let player = match self.0.as_ref()?.find_active() {
                Ok(p) => p,
                Err(mpris::FindingError::NoPlayerFound) => return None,
                Err(_) => {
                    self.0 = None; // the bus connection broke; reconnect next time
                    return None;
                }
            };
            let meta = player.get_metadata().ok()?;
            let status = player.get_playback_status().ok()?;
            if status == PlaybackStatus::Stopped {
                return None;
            }
            Some(Track {
                title: meta.title().unwrap_or_default().to_string(),
                artist: meta.artists().map(|a| a.join(", ")).unwrap_or_default(),
                album: meta.album_name().unwrap_or_default().to_string(),
                duration: meta.length().map(|d| d.as_secs_f64()),
                position: player.get_position().ok().map(|d| d.as_secs_f64()),
                playing: status == PlaybackStatus::Playing,
                player: player.identity().to_string(),
            })
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::Track;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    pub struct Reader(Option<Manager>);

    impl Reader {
        pub fn new() -> Self {
            Self(None)
        }

        pub fn now_playing(&mut self) -> Option<Track> {
            if self.0.is_none() {
                self.0 = Manager::RequestAsync().ok()?.join().ok();
            }
            let session = self.0.as_ref()?.GetCurrentSession().ok()?;
            let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
            let status = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
            if status != Status::Playing && status != Status::Paused {
                return None;
            }
            let playing = status == Status::Playing;
            let timeline = session.GetTimelineProperties().ok()?;
            // TimeSpan is in 100 ns ticks.
            let secs = |ticks: i64| ticks as f64 / 10_000_000.0;
            let end = timeline.EndTime().map(|t| secs(t.Duration)).unwrap_or(0.0);
            let mut position = timeline.Position().ok().map(|t| secs(t.Duration));
            // Players only update the position now and then; add the time since.
            if let (Some(p), true, Ok(updated)) = (position.as_mut(), playing, timeline.LastUpdatedTime()) {
                let since = secs(now_ticks() - updated.UniversalTime);
                if (0.0..600.0).contains(&since) {
                    *p += since;
                }
            }
            let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
            Some(Track {
                title: props.Title().map(|s| s.to_string()).unwrap_or_default(),
                artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
                album: props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
                duration: (end > 0.0).then_some(end),
                position,
                playing,
                player: player_name(&app),
            })
        }
    }

    /// Now as a Windows DateTime: 100 ns ticks since 1601-01-01.
    fn now_ticks() -> i64 {
        const UNIX_TO_1601: i64 = 11_644_473_600 * 10_000_000;
        let unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64 / 100)
            .unwrap_or(0);
        unix + UNIX_TO_1601
    }

    /// "Spotify.exe" or "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify".
    fn player_name(id: &str) -> String {
        let last = id.rsplit(['!', '\\']).next().unwrap_or(id);
        last.trim_end_matches(".exe").to_string()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Track;
    use std::process::Command;

    /// Asks Spotify and Music, only if they're running (so neither gets launched).
    /// JavaScript instead of AppleScript: AppleScript resolves `tell application`
    /// up front and asks "Where is Spotify?" when it isn't installed.
    const SCRIPT: &str = r#"
function run() {
  const out = [];
  for (const [name, ms] of [["Spotify", true], ["Music", false]]) {
    try {
      const app = Application(name);
      if (!app.running()) continue;
      const state = app.playerState();
      if (state === "stopped") continue;
      const t = app.currentTrack();
      out.push({
        title: t.name(), artist: t.artist(), album: t.album(),
        duration: ms ? t.duration() / 1000 : t.duration(),
        position: app.playerPosition(),
        playing: state === "playing",
        player: name,
      });
    } catch (e) {}
  }
  return JSON.stringify(out);
}"#;

    pub struct Reader;

    impl Reader {
        pub fn new() -> Self {
            Self
        }

        pub fn now_playing(&mut self) -> Option<Track> {
            let out = Command::new("osascript").args(["-l", "JavaScript", "-e", SCRIPT]).output().ok()?;
            let tracks: Vec<Track> = serde_json::from_slice(&out.stdout).ok()?;
            // A playing one first, else a paused one.
            let playing = tracks.iter().position(|t| t.playing).unwrap_or(0);
            tracks.into_iter().nth(playing)
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
mod platform {
    use super::Track;

    pub struct Reader;

    impl Reader {
        pub fn new() -> Self {
            Self
        }

        pub fn now_playing(&mut self) -> Option<Track> {
            None
        }
    }
}

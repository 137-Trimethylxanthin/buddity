//! A song's tempo (BPM) from Deezer's public API, so Verity dances in time.
//! Media players don't report tempo, and Spotify's audio-features API is closed
//! to new apps. Deezer doesn't allow calls from web pages (no CORS), so the
//! lookup happens here. Only the title and artist are sent.

use std::time::Duration;

use serde_json::Value;

const API: &str = "https://api.deezer.com";
const CANDIDATES: usize = 5;
const DURATION_SLACK_S: f64 = 6.0;
/// Shorter names than this must match exactly, not just appear inside the other.
const MIN_PARTIAL: usize = 3;

fn client() -> Option<reqwest::Client> {
    // Same TLS setup as the updater: rustls with ring, installed once.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()
}

async fn get(client: &reqwest::Client, url: reqwest::Url) -> Option<Value> {
    let bytes = client.get(url).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn same(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    let (a, b) = (norm(a), norm(b));
    let (short, long) = if a.chars().count() <= b.chars().count() { (&a, &b) } else { (&b, &a) };
    !short.is_empty() && (a == b || (short.chars().count() >= MIN_PARTIAL && long.contains(short.as_str())))
}

/// The song's BPM, or None if Deezer doesn't know it (it says 0 for many songs).
pub async fn song_bpm(title: &str, artist: &str, duration: Option<f64>) -> Option<f32> {
    let client = client()?;
    let search = reqwest::Url::parse_with_params(
        &format!("{API}/search"),
        &[("q", format!("{title} {artist}")), ("limit", CANDIDATES.to_string())],
    )
    .ok()?;
    let found = get(&client, search).await?;
    // The first result by the same artist, with a matching title and, if known, length.
    let id = found["data"].as_array()?.iter().find_map(|t| {
        // No artist from the player matches nothing: no BPM beats a wrong one (title and length alone collide too often).
        let artist_ok = same(t["artist"]["name"].as_str()?, artist);
        let title_ok = same(t["title_short"].as_str().or(t["title"].as_str())?, title);
        let length_ok = match (duration, t["duration"].as_f64()) {
            (Some(want), Some(have)) => (want - have).abs() <= DURATION_SLACK_S,
            _ => true,
        };
        (artist_ok && title_ok && length_ok).then(|| t["id"].as_u64()).flatten()
    })?;
    let track = get(&client, reqwest::Url::parse(&format!("{API}/track/{id}")).ok()?).await?;
    let bpm = track["bpm"].as_f64()? as f32;
    (bpm > 0.0).then_some(bpm)
}

#[cfg(test)]
mod tests {
    use super::same;

    #[test]
    fn exact_and_normalised() {
        assert!(same("Daft Punk", "daft punk"));
        assert!(same("AC/DC", "ACDC"));
        assert!(same("嵐", "嵐"));
    }

    #[test]
    fn contains_either_way() {
        assert!(same("The Beatles", "Beatles"));
        assert!(same("Get Lucky", "Get Lucky (feat. Pharrell Williams)"));
    }

    #[test]
    fn empty_never_matches() {
        assert!(!same("Daft Punk", ""));
        assert!(!same("", "Daft Punk"));
        assert!(!same("", ""));
        assert!(!same("Daft Punk", " - "));
    }

    #[test]
    fn short_names_only_exactly() {
        assert!(same("U2", "u2"));
        assert!(!same("U2", "U2 Tribute Band Featuring"));
        assert!(!same("Elvis Presley", "is"));
        assert!(same("ABBA Gold", "abba"));
    }

    #[test]
    fn different_names() {
        assert!(!same("Daft Punk", "Justice"));
    }
}

// The music you're listening to: which song, where in it, and its lyrics.
// The backend reports what's playing every couple of seconds; this keeps track
// of song changes and pauses, guesses the position in between, and looks up
// time-synced lyrics on lrclib.net and the tempo on deezer.com (only the song's
// title, artist, album and length are sent).
import { songBpm, type Track } from "./native";

export interface LyricLine {
  /** Seconds into the song. */
  t: number;
  text: string;
}

export interface MusicHooks {
  /** A new song started (or he just noticed one playing). */
  onSong(track: Track): void;
  onPause(track: Track): void;
  onResume(track: Track): void;
  /** Nothing is playing any more. */
  onStop(): void;
}

const LYRICS_TIMEOUT_MS = 8000;
const MIN_LYRIC_LINES = 4; // fewer than this is a placeholder or junk entry, not lyrics

export function songKey(t: Track): string {
  return `${t.artist}\n${t.title}`;
}

export class Music {
  track: Track | null = null;
  lyrics: LyricLine[] | null = null;
  /** The song's tempo, if known. */
  bpm: number | null = null;
  private readAt = 0; // performance.now() when track.position was read
  private lyricsFor = "";
  /** The lyrics lookup for the current song has finished (lyrics stays null if there were none). */
  lyricsDone = false;
  private tempoFor = "";
  private started = false; // the current song has been heard playing

  constructor(private readonly hooks: MusicHooks) {}

  get playing(): boolean {
    return this.track?.playing ?? false;
  }

  update(next: Track | null): void {
    const prev = this.track;
    this.track = next && cleanTrack(next);
    this.readAt = performance.now();
    if (!this.track) {
      if (prev) this.hooks.onStop();
      return;
    }
    const same = prev !== null && songKey(prev) === songKey(this.track);
    if (!same) {
      this.lyrics = null;
      this.lyricsDone = false;
      this.bpm = null;
      this.started = false;
    }
    // A song "starts" the first time it's heard playing (it may have been noticed paused).
    if (this.track.playing && !this.started) {
      this.started = true;
      this.hooks.onSong(this.track);
    } else if (same && prev.playing && !this.track.playing) {
      this.hooks.onPause(this.track);
    } else if (same && !prev.playing && this.track.playing) {
      this.hooks.onResume(this.track);
    }
  }

  /** Seconds into the song right now, if the player says where it is. */
  position(): number | null {
    const t = this.track;
    if (!t || t.position === null) return null;
    return t.position + (t.playing ? (performance.now() - this.readAt) / 1000 : 0);
  }

  /** Looks up the current song's tempo once; bpm stays null if it's unknown. */
  async loadTempo(): Promise<void> {
    const t = this.track;
    if (!t || this.tempoFor === songKey(t)) return;
    this.tempoFor = songKey(t);
    const bpm = await songBpm(t);
    if (this.track && songKey(this.track) === songKey(t)) this.bpm = bpm;
  }

  /**
   * Beats into the song, at a tempo that's comfortable to dance to (fast songs
   * at half time, slow ones at double). Null without a known tempo and position.
   * The beat grid starts at the song's start; the real first beat may be later.
   */
  beat(): number | null {
    const pos = this.position();
    if (this.bpm === null || pos === null) return null;
    let bpm = this.bpm;
    while (bpm > 140) bpm /= 2;
    while (bpm < 70) bpm *= 2;
    return (pos * bpm) / 60;
  }

  /** Looks up the current song's lyrics once; lyrics stays null if there are none. */
  async loadLyrics(): Promise<void> {
    const t = this.track;
    if (!t || this.lyricsFor === songKey(t)) return;
    this.lyricsFor = songKey(t);
    const found = await fetchLyrics(t);
    if (this.track && songKey(this.track) === songKey(t)) {
      this.lyrics = found;
      this.lyricsDone = true;
    }
  }
}

/**
 * Browser tabs report YouTube-style titles: "Artist - Song (Official Video)" by
 * "ArtistVEVO". Tidy those so the lyrics lookup and his comments make sense.
 */
function cleanTrack(t: Track): Track {
  let { title, artist } = t;
  title = title
    .replace(/\s*[([](official|lyrics?|audio|video|music video|hd|4k|visuali[sz]er|remaster(ed)?)[^)\]]*[)\]]/gi, "")
    .trim();
  const dash = title.indexOf(" - ");
  if (dash > 0 && (!artist || /vevo|topic|official/i.test(artist) || title.slice(0, dash).includes(artist))) {
    artist = title.slice(0, dash).trim();
    title = title.slice(dash + 3).trim();
  }
  artist = artist.replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").trim();
  // "Song (feat. X) - Some Remix" → "Song": what lyrics and tempo sites list it as.
  title = title
    .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+[^-]*\b(remix|remaster(ed)?|version|edit|mix|live|mono|stereo|acoustic)\b.*$/i, "")
    .trim();
  return { ...t, title, artist };
}

interface LrclibEntry {
  syncedLyrics: string | null;
}

async function lrclib(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `https://lrclib.net/api/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(LYRICS_TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json();
}

/** Time-synced lyrics from lrclib.net: an exact match first, then a search. Null if none. */
export async function fetchLyrics(t: Track): Promise<LyricLine[] | null> {
  if (!t.title || !t.artist) return null;
  try {
    const exact: Record<string, string> = { track_name: t.title, artist_name: t.artist };
    if (t.album) exact.album_name = t.album;
    if (t.duration) exact.duration = String(Math.round(t.duration));
    const hit = (await lrclib("get", exact)) as LrclibEntry | null;
    let lines = hit?.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
    if (lines.length < MIN_LYRIC_LINES) {
      const found = (await lrclib("search", { track_name: t.title, artist_name: t.artist })) as LrclibEntry[] | null;
      for (const entry of found ?? []) {
        lines = entry.syncedLyrics ? parseLrc(entry.syncedLyrics) : [];
        if (lines.length >= MIN_LYRIC_LINES) break;
      }
    }
    return lines.length >= MIN_LYRIC_LINES ? lines : null;
  } catch {
    return null; // offline, timed out, or lrclib is down
  }
}

/** "[01:02.34] text" lines, sorted, without empty ones. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const m of stamps) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

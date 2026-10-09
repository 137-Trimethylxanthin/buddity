// Thin bridge to the Tauri backend. Every call degrades to a no-op in a plain
// browser (`bun run dev` without Tauri) so the character can be worked on there.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Chattiness, Setting } from "./store";
import type { AccessoryId } from "./wardrobe";
import type { FacePose } from "./face";
import type { SkinId } from "./skins";

export const inTauri = "__TAURI_INTERNALS__" in window;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function setHitRegions(rects: Rect[]): void {
  if (inTauri) void invoke("set_hit_regions", { rects });
}

export async function getUsername(): Promise<string> {
  return inTauri ? invoke<string>("get_username") : "friend";
}

/** How long the computer has been on, in seconds (null if unknown). */
export async function getUptime(): Promise<number | null> {
  return inTauri ? invoke<number | null>("get_uptime").catch(() => null) : null;
}

/** Put the real system cursor on a point of the window (CSS pixels). */
export function cursorTo(x: number, y: number): Promise<void> {
  return inTauri ? invoke<void>("cursor_to", { x, y }) : Promise.resolve();
}

/** Scroll the window under the cursor (positive = down). */
export function scrollActive(lines: number): void {
  if (inTauri) invoke("scroll_active", { lines }).catch(() => {});
}

/** Global cursor position relative to the window, in CSS pixels. */
export function onCursor(cb: (x: number, y: number) => void): void {
  if (inTauri) void listen<[number, number]>("cursor", (e) => cb(e.payload[0], e.payload[1]));
}

export function onTray(cb: (id: string) => void): void {
  if (inTauri) void listen<string>("tray", (e) => cb(e.payload));
}

/** Quit only pretended: he hides now and the backend calls him back later. */
export function onFakeQuit(hide: () => void, cameBack: () => void): void {
  if (!inTauri) return;
  void listen("fake-quit", hide);
  void listen("came-back", cameBack);
}

/** Verity's Discord status (Rich Presence); null clears it. */
export function discordStatus(status: { details: string; state: string } | null): void {
  if (inTauri) invoke("discord_status", { status }).catch(() => {});
}

/** Open the settings window (or bring it to the front); "looks" scrolls it to the skins and wardrobe, no section to the top. */
export function openSettings(section?: "looks"): void {
  if (inTauri) invoke("open_settings", { section: section ?? null }).catch(() => {});
}

/** The backend asks an already open settings window to show a section. */
export function onSettingsSection(cb: (section: string) => void): void {
  if (inTauri) void listen<string>("settings-section", (e) => cb(e.payload));
}

/** The settings window tells the character window which skin to wear. */
export function sendSkin(id: SkinId): void {
  if (inTauri) void emit("skin", id);
}

export function onSkin(cb: (id: SkinId) => void): void {
  if (inTauri) void listen<SkinId>("skin", (e) => cb(e.payload));
}

/** The settings window tells the character window when a setting changes. */
export function sendSetting(key: Setting, on: boolean): void {
  if (inTauri) void emit("setting", { key, on });
}

export function onSetting(cb: (key: Setting, on: boolean) => void): void {
  if (inTauri) void listen<{ key: Setting; on: boolean }>("setting", (e) => cb(e.payload.key, e.payload.on));
}

/** The settings window tells the character window how often he may talk on his own. */
export function sendChattiness(c: Chattiness): void {
  if (inTauri) void emit("chattiness", c);
}

export function onChattiness(cb: (c: Chattiness) => void): void {
  if (inTauri) void listen<Chattiness>("chattiness", (e) => cb(e.payload));
}

/** The wardrobe (in the settings window) tells the character window what he's wearing now. */
export function sendWardrobe(worn: AccessoryId[]): void {
  if (inTauri) void emit("wardrobe", worn);
}

export function onWardrobe(cb: (worn: AccessoryId[]) => void): void {
  if (inTauri) void listen<AccessoryId[]>("wardrobe", (e) => cb(e.payload));
}

/** A song a media player has loaded (see src-tauri/src/music.rs). */
export interface Track {
  title: string;
  artist: string;
  album: string;
  /** Seconds, if known. */
  duration: number | null;
  /** Seconds into the song when it was read, if known. */
  position: number | null;
  playing: boolean;
  /** The app playing it, e.g. "Spotify". */
  player: string;
}

/** Watch what music is playing (the "music" setting). */
export function setMusic(on: boolean): void {
  if (inTauri) invoke("set_music", { on }).catch(() => {});
}

/** What's playing, every couple of seconds while something is; null once when it stops. */
export function onMusic(cb: (track: Track | null) => void): void {
  if (inTauri) void listen<Track | null>("music", (e) => cb(e.payload));
}

/** Facts about the computer (see src-tauri/src/pcinfo.rs). */
export interface PcInfo {
  os: string;
  cpu: string;
  cores: number;
  /** Average CPU load in %, since the last call. */
  cpu_load: number;
  ram_used_gb: number;
  ram_total_gb: number;
  /** The app using the most memory and how much (GB). */
  top_app: [string, number] | null;
  /** Charge in % and whether it's charging; null without a battery. */
  battery: [number, boolean] | null;
}

export async function getPcInfo(): Promise<PcInfo | null> {
  return inTauri ? invoke<PcInfo>("pc_info").catch(() => null) : null;
}

/** The song's tempo from deezer.com, if it's known there. */
export async function songBpm(t: Track): Promise<number | null> {
  if (!inTauri) return null;
  return invoke<number | null>("song_bpm", { title: t.title, artist: t.artist, duration: t.duration }).catch(() => null);
}

/** A screen in the desktop's layout, in physical pixels. */
export interface Screen {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the window sits across it (the work area, so not under a side taskbar or dock). */
  left: number;
  width: number;
  scale: number;
  /** The window is on this one. */
  current: boolean;
  primary: boolean;
  /** A mirror window is on this screen, so he can be drawn here while crossing. */
  mirror: boolean;
  /** Physical y of the bottom of the usable area (his floor on this screen). */
  floor: number;
}

export async function getScreens(): Promise<Screen[]> {
  return inTauri ? invoke<Screen[]>("screens").catch(() => []) : [];
}

/** Move the window to another screen; false where that isn't possible. */
export async function moveToScreen(index: number): Promise<boolean> {
  if (!inTauri) return false;
  return invoke("move_to_screen", { index }).then(
    () => true,
    () => false,
  );
}

/** One frame of Verity for the mirror windows; null when he's no longer crossing. */
export interface MirrorFrame {
  /** Counts crossings, so the character window knows when the mirrors are drawing this one. */
  session: number;
  /** The screen the character window is on (null while it's moving). */
  owner: number | null;
  /** The character window draws its own part; the mirror on its screen stays out of the way. */
  ownerDraws: boolean;
  skin: SkinId;
  worn: AccessoryId[];
  /** His element's classes (evil glow, dangling while held). */
  cls: string;
  /** Physical x of his box's left edge on the desktop. */
  x: number;
  /** Physical pixels from his box's bottom down to the floor of his screen. */
  bottom: number;
  pose: FacePose;
}

export function sendMirror(frame: MirrorFrame | null): void {
  if (inTauri) void emit("mirror", frame);
}

export function onMirror(cb: (frame: MirrorFrame | null) => void): void {
  if (inTauri) void listen<MirrorFrame | null>("mirror", (e) => cb(e.payload));
}

/** A mirror tells the character window it has drawn a frame of this crossing, on its screen. */
export interface MirrorShown {
  session: number;
  screen: number;
}

export function sendMirrorShown(shown: MirrorShown): void {
  if (inTauri) void emit("mirror-shown", shown);
}

export function onMirrorShown(cb: (shown: MirrorShown) => void): void {
  if (inTauri) void listen<MirrorShown>("mirror-shown", (e) => cb(e.payload));
}

/** Another app's window: its app name (never its title) and where it is, in physical desktop pixels. */
export interface AppWindow {
  id: string;
  app: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** One of the system's menus that pop open over everything (Windows' Start menu and the like). */
  menu: boolean;
}

/** Watch where other apps' windows are (the "windows" setting). */
export function setAppWindows(on: boolean): void {
  if (inTauri) invoke("set_app_windows", { on }).catch(() => {});
}

/** The visible windows, front to back, whenever they change. */
export function onAppWindows(cb: (windows: AppWindow[]) => void): void {
  if (inTauri) void listen<AppWindow[]>("app-windows", (e) => cb(e.payload));
}

/** Check windows every frame while he's standing on one, so he moves smoothly with it. */
export function appWindowsFast(on: boolean): void {
  if (inTauri) invoke("app_windows_fast", { on }).catch(() => {});
}

// Thin bridge to the Tauri backend. Every call degrades to a no-op in a plain
// browser (`bun run dev` without Tauri) so the character can be worked on there.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Setting } from "./store";

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

export function openSettings(): void {
  if (inTauri) invoke("open_settings").catch(() => {});
}

/** The settings window tells the character window when a setting changes. */
export function sendSetting(key: Setting, on: boolean): void {
  if (inTauri) void emit("setting", { key, on });
}

export function onSetting(cb: (key: Setting, on: boolean) => void): void {
  if (inTauri) void listen<{ key: Setting; on: boolean }>("setting", (e) => cb(e.payload.key, e.payload.on));
}

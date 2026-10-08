// Thin bridge to the Tauri backend. Every call degrades to a no-op in a plain
// browser (`bun run dev` without Tauri) so the character can be worked on there.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

/** Global cursor position relative to the window, in CSS pixels. */
/** Move the real system cursor by (dx, dy) pixels. */
export function nudgeCursor(dx: number, dy: number): void {
  if (inTauri) invoke("nudge_cursor", { dx: Math.round(dx), dy: Math.round(dy) }).catch(() => {});
}

/** Scroll the window under the cursor (positive = down). */
export function scrollActive(lines: number): void {
  if (inTauri) invoke("scroll_active", { lines }).catch(() => {});
}

export function onCursor(cb: (x: number, y: number) => void): void {
  if (inTauri) void listen<[number, number]>("cursor", (e) => cb(e.payload[0], e.payload[1]));
}

export function onTray(cb: (id: string) => void): void {
  if (inTauri) void listen<string>("tray", (e) => cb(e.payload));
}

// Other apps' windows as places: ledges he can stand on (a window's top edge,
// or its bottom edge from inside), and which app's window he's in front of.
// Everything is converted to the character window's coordinates.
import type { Platform } from "./buddy";
import type { AppWindow, Screen } from "./native";

/** A window in the character window's coordinates (y from the floor convention, like the mirrors). */
export interface WindowBox {
  id: string;
  app: string;
  x: number;
  y: number;
  w: number;
  h: number;
  menu: boolean;
}

/** Where he is: in front of a window, or standing on top of one. */
export interface Place {
  app: string;
  on: "top" | "in";
}

const NEAR_FLOOR = 24; // a ledge this close to the floor is just the floor
const MIN_LEDGE = 0.6; // of his width: shorter visible stretches aren't worth standing on

/**
 * Converts windows (physical desktop px) to the character window's px, relative
 * to the screen `here` (scaled like physicalX in main.ts). Heights are measured
 * from each window's own screen's floor, so bars of different heights on
 * different screens line up. Windows on screens above or below `here` are left out.
 */
export function toBoxes(windows: AppWindow[], screens: Screen[], here: Screen, viewHeight: number): WindowBox[] {
  return windows.flatMap((w) => {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    const s = screens.find((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h);
    if (!s || s.y >= here.y + here.h || s.y + s.h <= here.y) return []; // off screen, or not side by side with this one
    const y = viewHeight - (s.floor - w.y) / here.scale;
    return [{ id: w.id, app: w.app, x: (w.x - here.left) / here.scale, y, w: w.w / here.scale, h: w.h / here.scale, menu: w.menu }];
  });
}

/** The visible stretches of a horizontal edge at y from x1 to x2, given the windows in front. */
function visible(x1: number, x2: number, y: number, inFront: WindowBox[]): [number, number][] {
  let parts: [number, number][] = [[x1, x2]];
  for (const f of inFront) {
    if (y < f.y || y > f.y + f.h) continue;
    parts = parts.flatMap(([a, b]): [number, number][] => {
      if (f.x + f.w <= a || f.x >= b) return [[a, b]];
      const keep: [number, number][] = [];
      if (f.x > a) keep.push([a, f.x]);
      if (f.x + f.w < b) keep.push([f.x + f.w, b]);
      return keep;
    });
  }
  return parts;
}

/** Ledges on the windows' top edges (on the roof) and bottom edges (inside). */
export function ledges(boxes: WindowBox[], viewHeight: number, w: number, h: number): Platform[] {
  const out: Platform[] = [];
  boxes.forEach((b, i) => {
    const inFront = boxes.slice(0, i);
    for (const [kind, y] of [["top", b.y], ["in", b.y + b.h]] as const) {
      if (y - h < 0 || viewHeight - y < NEAR_FLOOR) continue; // no headroom, or it's the floor anyway
      for (const [x1, x2] of visible(b.x, b.x + b.w, y, inFront)) {
        if (x2 - x1 >= w * MIN_LEDGE) out.push({ id: `${b.id}:${kind}`, x1, x2, y, anchor: b.x });
      }
    }
  });
  return out;
}

/** The window he's on top of, or the frontmost one his middle is in front of. */
export function placeOf(boxes: WindowBox[], standingOn: Platform | null, cx: number, cy: number): Place | null {
  if (standingOn) {
    const [id, kind] = standingOn.id.split(/:(?=[^:]+$)/);
    const box = boxes.find((b) => b.id === id);
    if (box) return { app: box.app, on: kind === "top" ? "top" : "in" };
  }
  const box = boxes.find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
  return box ? { app: box.app, on: "in" } : null;
}

/** Whether a media player's name and a window's app name are the same app ("Zen Browser" ~ "zen"). */
export function sameApp(player: string, app: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]/g, "");
  const [a, b] = [norm(player), norm(app)];
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** "kitty" → "Kitty", "org.gnome.Nautilus" → "Nautilus". */
export function appName(app: string): string {
  const last = app.split(".").pop() ?? app;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

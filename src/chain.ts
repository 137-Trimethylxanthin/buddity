// The chain: a loop of links around Verity's middle, running to an anchor bolt
// you can put anywhere (on the desktop, or on another app's window, which it
// then moves with). The chain itself is drawn here; how far it lets him go is
// Buddy.tether. It sags while it's slack and pulls straight when it's taut.

import type { WindowBox } from "./places";

export const CHAIN_MIN = 120;
export const CHAIN_MAX = 1200;
const ANCHOR_SIZE = 30;
const NS = "http://www.w3.org/2000/svg";

/** Where the anchor is (window px, its middle), how long the chain is, and the window it's bolted to. */
export interface ChainState {
  x: number;
  y: number;
  len: number;
  /** Bolted to another app's window: where on it. */
  win: { id: string; dx: number; dy: number } | null;
}

type Point = { x: number; y: number };

/** Where the loop goes round him (the ends of a belt round his middle) and his middle, in window px. */
interface Body {
  beltLeft: Point;
  beltRight: Point;
  mid: Point;
}

function svgLayer(cls: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("chain-layer", cls);
  return svg;
}

function path(parent: SVGElement, cls: string): SVGPathElement {
  const p = document.createElementNS(NS, "path");
  p.classList.add(cls);
  parent.append(p);
  return p;
}

/** Links along a path: rings with a hole, and the side-on links between them. */
function links(parent: SVGElement): SVGPathElement[] {
  return ["link-side", "link-ring", "link-hole"].map((c) => path(parent, c));
}

export class Chain {
  state: ChainState | null = null;
  readonly anchorEl: HTMLElement;
  private readonly back: SVGSVGElement; // behind him: the chain and the back of the loop
  private readonly front: SVGSVGElement; // in front: the front of the loop
  private readonly run: SVGPathElement[];
  private readonly loopBack: SVGPathElement[];
  private readonly loopFront: SVGPathElement[];

  constructor(stage: HTMLElement) {
    this.back = svgLayer("chain-back");
    this.front = svgLayer("chain-front");
    this.run = links(this.back);
    this.loopBack = links(this.back);
    this.loopFront = links(this.front);
    this.anchorEl = document.createElement("div");
    this.anchorEl.className = "chain-anchor";
    this.anchorEl.title = "Drag to move the anchor · scroll to make the chain longer or shorter";
    this.anchorEl.innerHTML =
      '<svg viewBox="0 0 30 30"><circle class="bolt-plate" cx="15" cy="15" r="11"/><circle class="bolt-ring" cx="15" cy="15" r="6.5"/><circle class="bolt-head" cx="15" cy="15" r="2.5"/></svg>';
    stage.append(this.back, this.front, this.anchorEl);
    this.show(false);
  }

  get on(): boolean {
    return this.state !== null;
  }

  /** Chain him to an anchor at (x, y). */
  attach(x: number, y: number, len: number, win: ChainState["win"] = null): void {
    this.state = { x, y, len: Math.max(CHAIN_MIN, Math.min(CHAIN_MAX, len)), win };
    this.show(true);
  }

  detach(): void {
    this.state = null;
    this.show(false);
  }

  /** Longer (positive) or shorter, within limits. */
  lengthen(by: number): void {
    if (this.state) this.state.len = Math.max(CHAIN_MIN, Math.min(CHAIN_MAX, this.state.len + by));
  }

  /** Move the anchor (it's no longer bolted to a window), kept inside the window. */
  moveTo(x: number, y: number): void {
    if (!this.state) return;
    const half = ANCHOR_SIZE / 2;
    this.state.x = Math.max(half, Math.min(innerWidth - half, x));
    this.state.y = Math.max(half, Math.min(innerHeight - half, y));
    this.state.win = null;
  }

  /** The window moved under it (a side taskbar or dock changed): the anchor stays put on the desktop. */
  shift(dx: number): void {
    if (this.state && !this.state.win) this.state.x += dx;
  }

  /** Bolt it to the front-most window under it (not a menu), or to nothing. */
  boltTo(boxes: WindowBox[]): void {
    const s = this.state;
    if (!s) return;
    const b = boxes.find((b) => !b.menu && s.x >= b.x && s.x <= b.x + b.w && s.y >= b.y && s.y <= b.y + b.h);
    s.win = b ? { id: b.id, dx: s.x - b.x, dy: s.y - b.y } : null;
  }

  /** Bolted to a window: goes where it goes (a window that's gone leaves the anchor where it was). True if it moved. */
  follow(boxes: WindowBox[]): boolean {
    const s = this.state;
    const b = s?.win && boxes.find((b) => b.id === s.win!.id);
    if (!s || !b) return false;
    const half = ANCHOR_SIZE / 2;
    const [x, y] = [s.x, s.y];
    s.x = Math.max(half, Math.min(innerWidth - half, b.x + s.win!.dx));
    s.y = Math.max(half, Math.min(innerHeight - half, b.y + s.win!.dy));
    return s.x !== x || s.y !== y;
  }

  /**
   * Where the anchor is in this window and how long the chain is, or null. An anchor
   * saved on a bigger screen (or before the window got its size) is kept inside it
   * here without forgetting where it was.
   */
  anchor(): { x: number; y: number; len: number } | null {
    const s = this.state;
    if (!s) return null;
    const half = ANCHOR_SIZE / 2;
    return { x: Math.max(half, Math.min(innerWidth - half, s.x)), y: Math.max(half, Math.min(innerHeight - half, s.y)), len: s.len };
  }

  /** Draw it for him where he is now. */
  draw(body: Body | null): void {
    const s = this.anchor();
    if (!s) return;
    for (const el of [this.back, this.front]) el.classList.toggle("hidden", !body);
    if (!body) return; // he's somewhere else for now (the jumpscare)
    this.anchorEl.style.transform = `translate(${s.x - ANCHOR_SIZE / 2}px, ${s.y - ANCHOR_SIZE / 2}px)`;
    // The loop goes round his belly, below his face, squashing and tilting with him (not rolling).
    // Tumbled upside down (Obesity thrown hard): left and right swap, so the back of the loop stays behind him.
    const [l, r] = body.beltLeft.x <= body.beltRight.x ? [body.beltLeft, body.beltRight] : [body.beltRight, body.beltLeft];
    const cx = (l.x + r.x) / 2;
    const cy = (l.y + r.y) / 2;
    const rx = Math.hypot(r.x - l.x, r.y - l.y) / 2;
    const ry = rx * 0.24;
    const tilt = Math.atan2(r.y - l.y, r.x - l.x);
    const deg = (tilt * 180) / Math.PI;
    const top = `M ${l.x} ${l.y} A ${rx} ${ry} ${deg} 0 1 ${r.x} ${r.y}`;
    const bottom = `M ${r.x} ${r.y} A ${rx} ${ry} ${deg} 0 1 ${l.x} ${l.y}`;
    for (const p of this.loopBack) p.setAttribute("d", top);
    for (const p of this.loopFront) p.setAttribute("d", bottom);
    // From the anchor to the side of the loop facing it, sagging by however much is slack.
    const [cos, sin] = [Math.cos(tilt), Math.sin(tilt)];
    const [ax, ay] = [(s.x - cx) * cos + (s.y - cy) * sin, -(s.x - cx) * sin + (s.y - cy) * cos]; // the anchor, in the loop's frame
    const a = Math.atan2(ay / ry, ax / rx);
    const [ex, ey] = [rx * Math.cos(a), ry * Math.sin(a)];
    const px = cx + ex * cos - ey * sin;
    const py = cy + ex * sin + ey * cos;
    const d = Math.hypot(body.mid.x - s.x, body.mid.y - s.y);
    const sag = Math.min(260, Math.sqrt(Math.max(0, s.len * s.len - d * d)) * 0.35);
    // A curve's lowest point is halfway between its ends' middle and its control point: the slack lies on the floor, not through it.
    const lowest = innerHeight - 4;
    const bend = Math.min((s.y + py) / 2 + sag * 2, 2 * lowest - (s.y + py) / 2);
    const run = `M ${s.x} ${s.y} Q ${(s.x + px) / 2} ${Math.max(bend, (s.y + py) / 2)} ${px} ${py}`;
    for (const p of this.run) p.setAttribute("d", run);
  }

  private show(on: boolean): void {
    for (const el of [this.back, this.front, this.anchorEl]) el.classList.toggle("hidden", !on);
  }

  /** Saved form, or null when he isn't chained. */
  serialize(): string {
    return JSON.stringify(this.state);
  }

  /** From the saved form; anything malformed leaves him free. */
  restore(raw: string | null): void {
    let s: unknown;
    try {
      s = JSON.parse(raw ?? "null");
    } catch {
      return;
    }
    if (!s || typeof s !== "object") return;
    const { x, y, len, win } = s as Record<string, unknown>;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (![x, y, len].every(finite)) return;
    const w = win && typeof win === "object" ? (win as Record<string, unknown>) : null;
    const bolted = w && typeof w.id === "string" && finite(w.dx) && finite(w.dy) ? { id: w.id, dx: w.dx, dy: w.dy } : null;
    this.attach(x as number, y as number, len as number, bolted);
  }
}

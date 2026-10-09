// The menu that pops up around Verity (right or middle click): labelled pills
// fanned out on an arc over the free side of him (above him when he's on the
// floor, tilted away from screen edges), with his name and what he's up to
// just over his head. (A left click on him pets him; talking is in here.)

export interface MenuItem {
  icon: string;
  label: string;
  /** The letter of the label that triggers it from the keyboard (shown underlined). */
  key: string;
  action: () => void;
  /** The main thing to do, shown filled in. */
  primary?: boolean;
  /** Shown greyed out and not clickable. */
  disabled?: boolean;
}

export interface MenuContent {
  title: string;
  status: string;
  items: MenuItem[];
}

/** His box in window pixels (the ball), and how far his hat sticks up above it. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
  hat: number;
}

/** What the pills must stay clear of: his ball, his hat and the name tag. */
interface Body {
  cx: number;
  cy: number;
  r: number;
  hat: Box | null;
  tag: Box | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEAVE_CLOSE_MS = 900;
const MARGIN = 8; // from the screen edges
const GAP = 6; // between pills
const BODY_GAP = 6; // between pills (or the name tag) and him
const HIT_PAD = 6; // extra catch area around each pill (covers the hover grow)
const STEP = 2; // degrees, when packing pills along the arc
const R_STEP = 4; // px, when growing the arc
/** Oval shapes to try, as [x, y] radius scales and how much rounder ones are preferred: round, wide, tall. */
const SHAPES: [number, number, number][] = [[1, 1, 1], [1.25, 1, 1.08], [1, 1.25, 1.08], [0.85, 1.5, 1.2]];
const SPAN = 210; // degrees: the most the arc spreads round him
const MAX_SHIFTS = 4; // nudges of the arc towards the free side before giving up on a radius

const overlaps = (a: Box, b: Box, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const onScreen = (b: Box): boolean =>
  b.x >= MARGIN && b.y >= MARGIN && b.x + b.w <= innerWidth - MARGIN && b.y + b.h <= innerHeight - MARGIN;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const hitsBody = (b: Box, body: Body): boolean => {
  const dx = body.cx - Math.max(b.x, Math.min(body.cx, b.x + b.w));
  const dy = body.cy - Math.max(b.y, Math.min(body.cy, b.y + b.h));
  return Math.hypot(dx, dy) < body.r + BODY_GAP || (!!body.hat && overlaps(b, body.hat, BODY_GAP)) || (!!body.tag && overlaps(b, body.tag, 4));
};

export class ContextMenu {
  private leaveTimer = 0;
  private items: MenuItem[] = [];
  private buttons: HTMLButtonElement[] = [];
  private rects: Box[] = [];

  constructor(
    private readonly el: HTMLElement,
    /** His element: resting on him keeps the menu open too. */
    private readonly body: HTMLElement,
    private readonly onLayout: () => void,
  ) {
    el.setAttribute("role", "menu");
    // The pills are separate islands (the gaps between them click through to the
    // desktop), so leaving one only starts the timer; entering any pill or him stops it.
    const inside = (n: EventTarget | null): boolean =>
      n instanceof Node && ((this.el.contains(n) && n !== this.el) || this.body.contains(n));
    const enter = () => window.clearTimeout(this.leaveTimer);
    const leave = (e: MouseEvent) => {
      if (!this.visible || inside(e.relatedTarget)) return;
      window.clearTimeout(this.leaveTimer);
      this.leaveTimer = window.setTimeout(() => this.close(), LEAVE_CLOSE_MS);
    };
    el.addEventListener("mouseover", enter);
    el.addEventListener("mouseout", leave);
    body.addEventListener("mouseenter", enter);
    body.addEventListener("mouseleave", leave);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // A left click anywhere else in the window closes it. (Outside the hit regions
    // clicks go through to other apps, so leaving the menu closes it too.)
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0 && !this.buttons.some((b) => b.contains(e.target as Node))) this.close();
    });
    // Shortcuts are extra: the window may never get keyboard focus (e.g. a Wayland overlay).
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  get visible(): boolean {
    return !this.el.classList.contains("hidden");
  }

  /** Where the pills catch the mouse, from their final layout (not mid-animation). Empty once closed. */
  hitRects(): Box[] {
    return this.visible ? this.rects : [];
  }

  /** Open around him, the pills fanned out over the side with the most room. */
  open(anchor: Anchor, content: MenuContent, creepy: boolean): void {
    window.clearTimeout(this.leaveTimer);
    // The main action sits in the middle of the arc, right over him.
    const rest = content.items.filter((it) => !it.primary);
    const primary = content.items.filter((it) => it.primary);
    const mid = Math.floor((content.items.length - 1) / 2);
    this.items = [...rest.slice(0, mid), ...primary, ...rest.slice(mid)];

    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = content.title;
    const status = document.createElement("div");
    status.className = "menu-status";
    status.textContent = content.status;
    const head = document.createElement("div");
    head.className = "menu-head";
    head.append(title, status);
    this.buttons = this.items.map((item, i) => this.slice(item, i));
    this.el.replaceChildren(head, ...this.buttons);
    this.el.classList.toggle("creepy", creepy);
    this.el.classList.remove("hidden");

    const sizes = this.buttons.map((b) => ({ w: b.offsetWidth, h: b.offsetHeight }));
    const cx = anchor.x + anchor.w / 2;
    const cy = anchor.y + anchor.h / 2;
    const top = anchor.y - anchor.hat;

    // The name tag: just over his head, or under him near the top of the screen.
    const hw = head.offsetWidth;
    const hh = head.offsetHeight;
    const hx = Math.max(MARGIN, Math.min(innerWidth - hw - MARGIN, cx - hw / 2));
    const above = top - BODY_GAP - hh;
    const hy = above >= MARGIN ? above : anchor.y + anchor.h + BODY_GAP;
    const tag = { x: hx, y: hy, w: hw, h: hh };
    head.style.left = `${hx}px`;
    head.style.top = `${hy}px`;

    const hat = anchor.hat > 0 ? { x: cx - anchor.w * 0.3, y: top, w: anchor.w * 0.6, h: anchor.hat } : null;
    const body = { cx, cy, r: Math.min(anchor.w, anchor.h) / 2, hat, tag };
    let boxes = arrange(sizes, body);
    // Beside a screen edge the tag over his head would keep the arc from curving over
    // him, so it goes, and his name and status move to the middle pill's tooltip.
    const middle = boxes[Math.floor((boxes.length - 1) / 2)];
    const up = Math.abs(middle.x + middle.w / 2 - cx) < 12 && middle.y + middle.h < cy;
    head.hidden = !up;
    if (!up) {
      boxes = arrange(sizes, { ...body, tag: null }, true);
      this.buttons[Math.floor((boxes.length - 1) / 2)].title = `${content.title} · ${content.status}`;
    }
    this.rects = boxes.map((b) => ({ x: b.x - HIT_PAD, y: b.y - HIT_PAD, w: b.w + 2 * HIT_PAD, h: b.h + 2 * HIT_PAD }));
    boxes.forEach((b, i) => {
      const btn = this.buttons[i];
      btn.style.left = `${b.x}px`;
      btn.style.top = `${b.y}px`;
      // Each pill pops out from him.
      btn.style.setProperty("--fx", `${cx - (b.x + b.w / 2)}px`);
      btn.style.setProperty("--fy", `${cy - (b.y + b.h / 2)}px`);
    });
    this.onLayout();
  }

  close(): void {
    window.clearTimeout(this.leaveTimer);
    if (!this.visible) return;
    this.el.classList.add("hidden");
    this.onLayout();
  }

  private slice(item: MenuItem, i: number): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.setAttribute("role", "menuitem");
    btn.className = "slice";
    btn.classList.toggle("primary", !!item.primary);
    btn.style.setProperty("--i", String(i));
    if (item.disabled) btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("aria-keyshortcuts", item.key.toUpperCase());

    const icon = document.createElement("span");
    icon.className = "slice-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.className = "slice-label";
    const at = item.label.toLowerCase().indexOf(item.key.toLowerCase());
    if (at < 0) label.textContent = item.label;
    else {
      const u = document.createElement("u");
      u.textContent = item.label[at];
      label.append(item.label.slice(0, at), u, item.label.slice(at + 1));
    }
    btn.append(icon, label);
    btn.addEventListener("click", () => this.run(item));
    return btn;
  }

  private run(item: MenuItem): void {
    if (item.disabled) return;
    this.close();
    item.action();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      return this.close();
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const live = this.buttons.filter((_, i) => !this.items[i].disabled);
      if (live.length === 0) return;
      const at = live.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : live.length - 1) : (at + step + live.length) % live.length;
      live[next].focus();
      return;
    }
    const item = this.items.find((it) => it.key.toLowerCase() === e.key.toLowerCase());
    if (item) {
      e.preventDefault();
      this.run(item);
    }
  }
}

/**
 * Boxes for the pills, in item order, left to right over the arc when it's above him.
 * Each pill sits just outside an oval around him (its inner edge on the oval). For a
 * few oval shapes (round; wide, for the floor; tall, beside a screen edge) it finds the
 * smallest one where every pill is on screen and clear of him, the name tag and each
 * other, and keeps whichever stays closest to him. The middle pill goes straight up if
 * there's room there, else the arc swings round towards the free side.
 */
function arrange(sizes: { w: number; h: number }[], body: Body, twoRows = false): Box[] {
  // The smallest pill decides which directions are open at all; the real pills are checked once placed.
  const small = { w: Math.min(...sizes.map((s) => s.w)), h: Math.min(...sizes.map((s) => s.h)) };
  const rMin = body.r + BODY_GAP;
  const rMax = Math.max(innerWidth, innerHeight);
  let best: { boxes: Box[]; reach: number } | null = null;
  let fallback: Box[] | null = null;
  for (const [sx, sy, penalty] of twoRows ? [[1, 1, 1]] : SHAPES) {
    for (let r = rMin; r <= rMax; r += R_STEP) {
      const tried = tryArc(sizes, body, r * sx, r * sy, small, twoRows);
      if (tried === null) continue;
      if (!tried.ok) {
        fallback ??= tried.boxes;
        continue;
      }
      // How far the furthest pill corner is from him: less mouse travel.
      const reach = penalty * Math.max(
        ...tried.boxes.map((b) => Math.hypot(Math.max(Math.abs(b.x - body.cx), Math.abs(b.x + b.w - body.cx)), Math.max(Math.abs(b.y - body.cy), Math.abs(b.y + b.h - body.cy)))),
      );
      if (!best || reach < best.reach) best = { boxes: tried.boxes, reach };
      break;
    }
  }
  if (best) return best.boxes;
  // A tiny screen: the first arc that was close, pushed on screen.
  return (fallback ?? sizes.map((s, i) => ({ x: body.cx - s.w / 2, y: body.cy - rMin - (i * s.h) / 2, ...s }))).map((b) => ({
    ...b,
    x: Math.max(MARGIN, Math.min(innerWidth - b.w - MARGIN, b.x)),
    y: Math.max(MARGIN, Math.min(innerHeight - b.h - MARGIN, b.y)),
  }));
}

/** The pills around an oval with these radii. Null if they can't fit along it. */
function tryArc(
  sizes: { w: number; h: number }[],
  body: Body,
  rx: number,
  ry: number,
  small: { w: number; h: number },
  /** Fill the arc from one end to the other, then carry on along a second row further out. */
  twoRows = false,
): { boxes: Box[]; ok: boolean } | null {
  const n = sizes.length;
  const mid = Math.floor((n - 1) / 2);
  // The box touching the oval from outside at this angle (0 = right, 90 = up).
  const at = (size: { w: number; h: number }, deg: number): Box => {
    const cos = Math.cos(rad(deg));
    const sin = Math.sin(rad(deg));
    return {
      x: body.cx + rx * cos - (size.w * (1 - cos)) / 2,
      y: body.cy - ry * sin - (size.h * (1 + sin)) / 2,
      w: size.w,
      h: size.h,
    };
  };

  // Which directions have room for a pill: the longest unbroken run of them.
  const fits = (deg: number) => {
    const b = at(small, deg);
    return onScreen(b) && !hitsBody(b, body);
  };
  let run = { start: 0, len: 0 };
  let start = 0;
  let len = 0;
  for (let d = 0; d < 720; d += STEP) {
    if (fits(d % 360)) {
      if (len === 0) start = d;
      len += STEP;
      if (len > run.len) run = { start, len };
    } else len = 0;
  }
  if (run.len < 60) return null;
  const a = run.start;
  const b = run.len >= 360 ? a + 360 : a + run.len - STEP;

  if (twoRows) {
    const boxes: Box[] = [];
    let row = 0;
    let push = (_: number) => 0; // how far out the second row starts at an angle
    let d = b;
    for (let i = 0; i < n; i++) {
      const place = (deg: number): Box => {
        const box = at(sizes[i], deg);
        const k = push(deg);
        return { ...box, x: box.x + k * Math.cos(rad(deg)), y: box.y - k * Math.sin(rad(deg)) };
      };
      const fine = (box: Box) => onScreen(box) && !hitsBody(box, body) && !boxes.some((o) => overlaps(box, o, GAP));
      while (d >= a && !fine(place(d))) d -= STEP;
      if (d < a) {
        if (row === 1) return null;
        // The inner row is full: the outer one starts past its pills (their width beside him, height above).
        row = 1;
        const w = Math.max(...boxes.map((o) => o.w));
        const h = Math.max(...boxes.map((o) => o.h));
        push = (deg) => GAP + Math.abs(Math.cos(rad(deg))) * w + Math.abs(Math.sin(rad(deg))) * h;
        d = b;
        i--;
        continue;
      }
      boxes.push(place(d));
    }
    return { boxes, ok: true };
  }

  // Pack outwards from the middle pill, each as close to the last as it fits.
  const pack = (centre: number): number[] => {
    const deg: number[] = [];
    deg[mid] = centre;
    const placed = [at(sizes[mid], centre)];
    const clear = (i: number, d: number) => !placed.some((p) => overlaps(at(sizes[i], d), p, GAP));
    for (let i = mid + 1; i < n; i++) {
      let d = deg[i - 1];
      while (!clear(i, d) && centre - d < 360) d -= STEP;
      deg[i] = d;
      placed.push(at(sizes[i], d));
    }
    for (let i = mid - 1; i >= 0; i--) {
      let d = deg[i + 1];
      while (!clear(i, d) && d - centre < 360) d += STEP;
      deg[i] = d;
      placed.push(at(sizes[i], d));
    }
    return deg;
  };
  let centre = [90, 450].find((u) => u >= a && u <= b) ?? (a + b) / 2;
  let deg = pack(centre);
  for (let shift = 0; shift < MAX_SHIFTS; shift++) {
    const lo = deg[n - 1];
    const hi = deg[0];
    if (hi - lo > b - a) return null;
    if (lo >= a && hi <= b) break;
    centre += lo < a ? a - lo : b - hi;
    deg = pack(centre);
  }
  // n angles from `from` to `to`, evenly spaced along the oval (not by angle, which bunches them on a long oval).
  const spaced = (from: number, to: number): number[] => {
    const marks = [0];
    const steps = Math.max(1, Math.ceil(Math.abs(from - to)));
    for (let k = 1; k <= steps; k++) {
      const d0 = rad(from + ((to - from) * (k - 1)) / steps);
      const d1 = rad(from + ((to - from) * k) / steps);
      marks.push(marks[k - 1] + Math.hypot(rx * (Math.cos(d1) - Math.cos(d0)), ry * (Math.sin(d1) - Math.sin(d0))));
    }
    const total = marks[steps];
    return sizes.map((_, i) => {
      const want = n > 1 ? (total * i) / (n - 1) : 0;
      let k = 0;
      while (k < steps && marks[k + 1] < want) k++;
      return from + ((to - from) * k) / steps;
    });
  };
  const valid = (boxes: Box[]) =>
    boxes.every((box, i) => onScreen(box) && !hitsBody(box, body) && boxes.every((o, j) => j === i || !overlaps(box, o, 2)));
  const packed = deg.map((d, i) => at(sizes[i], d));
  if (!valid(packed)) return { boxes: packed, ok: false };
  // Spread out evenly round him as far as there's room (up to SPAN), so it reads as a ring.
  const tight = deg[0] - deg[n - 1];
  for (let span = Math.min(SPAN, b - a); span > tight; span -= 10) {
    const c = Math.min(b - span / 2, Math.max(a + span / 2, centre));
    const even = spaced(c + span / 2, c - span / 2).map((d, i) => at(sizes[i], d));
    if (valid(even)) return { boxes: even, ok: true };
  }
  return { boxes: packed, ok: true };
}

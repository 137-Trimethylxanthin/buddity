// Movement for the free-roaming character: wandering (rolling with little hops),
// falling, bouncing off the screen edges, and being dragged or thrown around the
// full-screen overlay.

const GRAVITY = 2200; // px/s²
const MAX_THROW = 2800; // px/s
const WALL_BOUNCE = 0.6;
const FLOOR_FRICTION = 0.85;
const MIN_BOUNCE_VY = 260; // slower landings settle instead of bouncing
const MIN_IMPACT = 150; // weaker hits aren't reported
const HOP_CHANCE_PER_S = 0.7; // while rolling along
const KNOCK = 1.3; // hit by a window: flies off a bit faster than it was going
const KNOCK_POP = 280; // px/s up, so a sideways hit sends him arcing
const RELEASE_GRACE_MS = 30; // let go within this long of the last mouse move: a full throw
const RELEASE_FADE_MS = 40; // after that the throw fades out (gone after ~150 ms of holding still)

export type State = "idle" | "walk" | "fall" | "drag" | "exercise";

const BOX_SETTLE_MS = 300; // the window has been still this long: he can stand normally again
const BOX_STILL_MS = 80; // no update this long: the window has stopped moving

/** Another app's window he's inside, in window px. */
export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The window he's in (or on) while it's being moved or resized: its edges'
 * speeds (px/s) push him around. "in": all four edges are walls; "top": only
 * its top edge, as a moving floor he can be thrown off or slide off.
 */
interface Container extends Box {
  kind: "in" | "top";
  vLeft: number;
  vRight: number;
  vTop: number;
  vBottom: number;
  /** When the last position came in, and when it last changed. */
  at: number;
  movedAt: number;
}

/**
 * A ledge he can stand on: the top of another app's window, or its bottom
 * edge (standing inside it). One-way: he lands on it from above and can jump
 * up through it. x1..x2 is the part not hidden behind other windows.
 */
export interface Platform {
  /** The same window and edge keep the same id while the window moves. */
  id: string;
  x1: number;
  x2: number;
  y: number;
  /** The window's left edge, to carry him along when the window moves. */
  anchor: number;
}
export type Side = "floor" | "ceiling" | "left" | "right";

export interface Physics {
  walkSpeed: number;
  bounce: number;
}

export class Buddy {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  state: State = "fall";
  physics: Physics = { walkSpeed: 110, bounce: 0.45 };
  /** Optional override for where to wander next (creepy mode follows the cursor). */
  chooseTarget: (() => number | null) | null = null;
  /**
   * The outer left and right walls (window px). Null: this window's edges. With
   * several screens side by side they lie on the outermost screens, so he
   * moves straight through the edges between screens.
   */
  bounds: { left: number; right: number } | null = null;
  /** Ledges on other windows (window px, see Platform). */
  platforms: Platform[] = [];
  /** The ledge he's standing or walking on; null on the floor. */
  standingOn: Platform | null = null;
  /** While the window he's inside moves or is resized, he's loose in it: its walls are solid. */
  container: Container | null = null;

  private targetX = 0;
  private resumeWalk = false;
  private onArrive: (() => void) | null = null;
  private idleUntil = 0;
  private holdUntil = 0;
  private grab = { dx: 0, dy: 0, lastX: 0, lastY: 0, lastT: 0 };
  /** While dragged into a screen edge: which edge and how many px past it. */
  /** How far he's being pushed into the screen edges while dragged, in px (x right, y down). Corners push on both. */
  pressure: { x: number; y: number } | null = null;

  constructor(
    public w: number,
    public h: number,
    private readonly onStateChange: (s: State) => void,
    private readonly onImpact: (side: Side, speed: number) => void,
  ) {
    // Drop in from above the bottom-right corner.
    this.x = innerWidth - w - 80;
    this.y = -h;
  }

  private get minX(): number {
    return this.bounds?.left ?? 0;
  }

  private get maxX(): number {
    return (this.bounds?.right ?? innerWidth) - this.w;
  }

  /** Move him (and where he's walking to) by dx, e.g. into another screen's coordinates. */
  shift(dx: number): void {
    this.x += dx;
    this.targetX += dx;
    this.grab.lastX += dx; // a drag carries on without a jump in speed
  }

  private get floor(): number {
    return innerHeight - this.h;
  }

  /** Where his top is when he stands: on his ledge, or on the floor. */
  private get ground(): number {
    return this.standingOn ? this.standingOn.y - this.h : this.floor;
  }

  /**
   * New ledges (windows moved, opened or closed). Standing on one that moved,
   * he's carried along; if his has gone (or he'd hang off it) he falls.
   * carry=false when the coordinates themselves changed (the window moved screens).
   */
  setPlatforms(list: Platform[], carry = true): void {
    this.platforms = list;
    const on = this.standingOn;
    if (!on) return;
    const same = list.filter((p) => p.id === on.id);
    const mid = this.x + this.w / 2;
    const dx = carry && same.length ? same[0].anchor - on.anchor : 0;
    const next = same.find((p) => mid + dx >= p.x1 && mid + dx <= p.x2);
    if (!next) {
      this.standingOn = null;
      if (this.grounded) this.set("fall");
      return;
    }
    this.standingOn = next;
    this.x += dx;
    this.targetX += dx;
    if (this.grounded) this.y = next.y - this.h;
  }

  /**
   * The window he's inside (or loose in) has a new position or size. moving:
   * it was moved or resized (false when only the coordinates changed, e.g. the
   * character window switched screens). From now until it has been still for
   * a moment he's loose in it, thrown about by its walls and pulled down by gravity.
   */
  moveBox(b: Box, kind: "in" | "top", now: number, moving = true): void {
    if (this.state === "drag" || this.state === "exercise") return;
    const c = this.container;
    if (!c) {
      if (!moving) return;
      this.container = { ...b, kind, vLeft: 0, vRight: 0, vTop: 0, vBottom: 0, at: now, movedAt: now };
      this.onArrive = null;
      this.resumeWalk = false;
      this.set("fall");
      return;
    }
    if (moving) {
      // Speed of each edge, smoothed a little (resizing moves one edge, not the others).
      const dt = Math.max(0.008, (now - c.at) / 1000);
      const blend = (v: number, d: number) => v * 0.3 + (d / dt) * 0.7;
      c.vLeft = blend(c.vLeft, b.x - c.x);
      c.vRight = blend(c.vRight, b.x + b.w - (c.x + c.w));
      c.vTop = blend(c.vTop, b.y - c.y);
      c.vBottom = blend(c.vBottom, b.y + b.h - (c.y + c.h));
      c.movedAt = now;
    }
    Object.assign(c, { x: b.x, y: b.y, w: b.w, h: b.h, at: now });
  }

  /**
   * Hit by another app's window being dragged into him (window px/s): he's put
   * just outside its edge and flies off the way it was going, with a little pop up.
   */
  knock(vx: number, vy: number, by: Box): void {
    if (this.state === "drag" || this.state === "exercise") return;
    this.container = null;
    this.onArrive = null;
    this.resumeWalk = false;
    if (Math.abs(vx) >= Math.abs(vy)) {
      this.x = vx > 0 ? by.x + by.w : by.x - this.w;
      this.onImpact(vx > 0 ? "left" : "right", Math.abs(vx));
    } else {
      this.y = Math.min(this.floor, vy > 0 ? by.y + by.h : by.y - this.h);
      this.onImpact(vy > 0 ? "ceiling" : "floor", Math.abs(vy));
    }
    this.vx = vx * KNOCK;
    this.vy = Math.min(vy * KNOCK, -KNOCK_POP);
    this.set("fall");
  }

  /** The window he was loose in is gone. */
  leaveBox(): void {
    this.container = null;
  }

  /** Loose inside a moving window: gravity, and its four edges as solid walls that move. */
  private fallInBox(c: Container, dt: number, now: number): void {
    if (now - c.at > BOX_STILL_MS) c.vLeft = c.vRight = c.vTop = c.vBottom = 0; // stopped moving
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (c.kind === "top") return this.rideTop(c, dt, now);
    // Squeezed smaller than him: he stays in the middle of it (squashed in), rather than popping out.
    if (c.w < this.w) {
      this.x = c.x + (c.w - this.w) / 2;
      this.vx = (c.vLeft + c.vRight) / 2;
    }
    if (c.h < this.h) {
      this.y = c.y + c.h - this.h;
      this.vy = c.vBottom;
    }
    // Each wall: put him back inside, and if he was moving into it (relative to the wall), bounce off it.
    const left = c.x;
    const right = c.x + c.w - this.w;
    const top = c.y;
    const bottom = c.y + c.h - this.h;
    if (this.x < left) {
      this.x = left;
      const rel = this.vx - c.vLeft;
      if (rel < 0) {
        if (-rel > MIN_IMPACT) this.onImpact("left", -rel);
        this.vx = c.vLeft - rel * WALL_BOUNCE;
      }
    }
    if (this.x > right) {
      this.x = right;
      const rel = this.vx - c.vRight;
      if (rel > 0) {
        if (rel > MIN_IMPACT) this.onImpact("right", rel);
        this.vx = c.vRight - rel * WALL_BOUNCE;
      }
    }
    if (this.y < top) {
      this.y = top;
      const rel = this.vy - c.vTop;
      if (rel < 0) {
        if (-rel > MIN_IMPACT) this.onImpact("ceiling", -rel);
        this.vy = c.vTop - rel * WALL_BOUNCE;
      }
    }
    if (this.y >= bottom) {
      this.y = bottom;
      const rel = this.vy - c.vBottom;
      if (rel > 0) {
        if (rel > MIN_IMPACT) this.onImpact("floor", rel);
        this.vy = rel > MIN_BOUNCE_VY ? c.vBottom - rel * this.physics.bounce : c.vBottom;
      }
      // Rolling along the bottom slows down to the window's own speed.
      const carry = (c.vLeft + c.vRight) / 2;
      this.vx = carry + (this.vx - carry) * Math.exp(-dt * 3);
      // The window has been still for a moment and he's resting on its bottom: back to standing.
      if (now - c.movedAt > BOX_SETTLE_MS && Math.abs(this.vy - c.vBottom) < 1 && Math.abs(this.vx - carry) < 20) {
        this.settle(c, c.y + c.h, now);
      }
    }
  }

  /** On top of a moving window: its top edge is a floor that moves; he can fly off it or roll off its ends. */
  private rideTop(c: Container, dt: number, now: number): void {
    const mid = this.x + this.w / 2;
    if (mid < c.x || mid > c.x + c.w) {
      this.container = null; // slid or was carried off the end: just falling now
      return;
    }
    const floor = c.y - this.h;
    if (this.y < floor) return; // in the air above it (thrown up, or it dropped away)
    // Sunk into the top since last frame (it rose, or he landed): back on top. Far below means he fell past it.
    if (this.y - floor > this.h * 0.6) {
      this.container = null;
      return;
    }
    this.y = floor;
    const rel = this.vy - c.vTop;
    if (rel > 0) {
      if (rel > MIN_IMPACT) this.onImpact("floor", rel);
      this.vy = rel > MIN_BOUNCE_VY ? c.vTop - rel * this.physics.bounce : c.vTop;
    }
    const carry = (c.vLeft + c.vRight) / 2;
    this.vx = carry + (this.vx - carry) * Math.exp(-dt * 3);
    if (now - c.movedAt > BOX_SETTLE_MS && Math.abs(this.vy - c.vTop) < 1 && Math.abs(this.vx - carry) < 20) {
      this.settle(c, c.y, now);
    }
  }

  /** The window has been still a moment and he's resting on it: back to standing on its ledge. */
  private settle(c: Container, y: number, now: number): void {
    this.container = null;
    this.vx = this.vy = 0;
    const mid = this.x + this.w / 2;
    this.standingOn = this.platforms.find((p) => p.id === `${c.id}:${c.kind}` && mid >= p.x1 && mid <= p.x2) ?? null;
    this.y = y - this.h;
    this.land(now);
  }

  /** The ledge he lands on falling from bottom y0 to y1 (window px), if any. */
  private ledgeBetween(y0: number, y1: number): Platform | null {
    const mid = this.x + this.w / 2;
    let best: Platform | null = null;
    for (const p of this.platforms) {
      if (p.y < y0 - 0.5 || p.y > y1 || mid < p.x1 || mid > p.x2) continue;
      if (!best || p.y < best.y) best = p;
    }
    return best;
  }

  /**
   * Jump onto a ledge (or any spot) with his centre at x and his bottom at y,
   * in an arc that stays below the top of the screen. False if there's no room.
   */
  jumpTo(x: number, y: number): boolean {
    if (!this.grounded) return false;
    const bottom = this.y + this.h;
    const rise = bottom - y; // how far up the target is
    const apex = Math.max(rise + 70, 70);
    if (apex > this.y) return false; // the arc would hit the top of the screen
    const vy = Math.sqrt(2 * GRAVITY * apex);
    const t = vy / GRAVITY + Math.sqrt((2 * (apex - rise)) / GRAVITY);
    this.onArrive = null;
    this.resumeWalk = false;
    this.vx = (x - (this.x + this.w / 2)) / t;
    this.vy = -vy;
    this.set("fall");
    return true;
  }

  get grounded(): boolean {
    return this.state === "idle" || this.state === "walk";
  }

  /** Current velocity, including walking (which doesn't use vx). */
  get velocity(): [number, number] {
    if (this.state === "walk") return [Math.sign(this.targetX - this.x) * this.physics.walkSpeed, 0];
    return [this.vx, this.vy];
  }

  /** Change size (skins), keeping the bottom edge where it was. */
  resize(w: number, h: number): void {
    this.x += (this.w - w) / 2;
    this.y += this.h - h;
    this.w = w;
    this.h = h;
    if (this.grounded) this.set("fall");
  }

  private set(state: State): void {
    if (this.state === state) return;
    if (state === "fall" || state === "drag" || state === "exercise") this.standingOn = null;
    if (state === "drag" || state === "exercise") this.container = null;
    this.state = state;
    this.onStateChange(state);
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number, now: number): void {
    switch (this.state) {
      case "drag":
      case "exercise":
        return;
      case "fall":
        return this.fall(dt, now);
      case "walk":
        return this.walk(dt, now);
      case "idle":
        if (this.y < this.ground - 1) this.set("fall"); // screen resized under us, or his ledge moved
        else if (now >= this.idleUntil && now >= this.holdUntil) this.wander();
        return;
    }
  }

  private fall(dt: number, now: number): void {
    if (this.container) return this.fallInBox(this.container, dt, now);
    const { minX, maxX } = this;
    const bottomBefore = this.y + this.h;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Falling onto a window's ledge.
    const ledge = this.vy > 0 ? this.ledgeBetween(bottomBefore, this.y + this.h) : null;
    if (ledge) {
      this.y = ledge.y - this.h;
      if (this.vy > MIN_IMPACT) this.onImpact("floor", this.vy);
      if (this.vy > MIN_BOUNCE_VY) {
        this.vy = -this.vy * this.physics.bounce;
        this.vx *= FLOOR_FRICTION;
      } else {
        this.vy = 0;
        this.vx = 0;
        this.standingOn = ledge; // before land(), which may set off what he does next
        this.land(now);
      }
      return;
    }

    if (this.x < minX || this.x > maxX) {
      const side: Side = this.x < minX ? "left" : "right";
      this.x = Math.max(minX, Math.min(maxX, this.x));
      if (Math.abs(this.vx) > MIN_IMPACT) this.onImpact(side, Math.abs(this.vx));
      this.vx = -this.vx * WALL_BOUNCE;
    }
    if (this.y < 0 && this.vy < 0) {
      this.y = 0;
      if (-this.vy > MIN_IMPACT) this.onImpact("ceiling", -this.vy);
      this.vy = -this.vy * WALL_BOUNCE;
    }
    if (this.y >= this.floor) {
      this.y = this.floor;
      if (this.vy > MIN_IMPACT) this.onImpact("floor", this.vy);
      if (this.vy > MIN_BOUNCE_VY) {
        this.vy = -this.vy * this.physics.bounce;
        this.vx *= FLOOR_FRICTION;
      } else {
        this.vy = 0;
        this.vx = 0;
        this.land(now);
      }
    }
  }

  private land(now: number): void {
    if (this.resumeWalk && Math.abs(this.targetX - this.x) > 8) {
      this.set("walk");
    } else if (this.onArrive) {
      this.arrive(now);
    } else {
      this.resumeWalk = false;
      this.rest(now, 1200 + Math.random() * 1500);
    }
  }

  private arrive(now: number): void {
    const done = this.onArrive;
    this.onArrive = null;
    this.resumeWalk = false;
    this.rest(now, 1500);
    done?.();
  }

  private walk(dt: number, now: number): void {
    const dir = Math.sign(this.targetX - this.x);
    this.x += dir * this.physics.walkSpeed * dt;
    const on = this.standingOn;
    const mid = this.x + this.w / 2;
    if (on && (mid < on.x1 || mid > on.x2)) {
      // Rolled off the end of the ledge: drop, then carry on to where he was going.
      this.vx = dir * this.physics.walkSpeed;
      this.vy = 0;
      this.resumeWalk = true;
      this.set("fall");
      return;
    }
    if (dir === 0 || Math.sign(this.targetX - this.x) !== dir) {
      this.x = this.targetX;
      if (this.onArrive) return this.arrive(now);
      this.resumeWalk = false;
      this.rest(now, 2500 + Math.random() * 6000);
    } else if (Math.random() < HOP_CHANCE_PER_S * dt) {
      this.hop();
    }
  }

  private rest(now: number, ms: number): void {
    this.idleUntil = now + ms;
    this.set("idle");
  }

  private wander(): void {
    // Strolls around the screen he's on (going to another screen is up to the caller).
    // On a ledge he mostly strolls along it.
    const on = this.standingOn;
    const maxX = on ? on.x2 - this.w / 2 - 10 : Math.min(this.maxX, innerWidth - this.w);
    const minX = on ? on.x1 - this.w / 2 + 10 : Math.max(this.minX, 0);
    const wanted = this.chooseTarget?.();
    const target = wanted ?? this.x + (Math.random() - 0.5) * 700;
    this.targetX = Math.max(minX, Math.min(maxX, target));
    this.set("walk");
  }

  /** A little jump. While walking it carries on rolling afterwards. */
  hop(power = 1): void {
    if (!this.grounded) return;
    this.resumeWalk = this.state === "walk";
    this.vx = this.resumeWalk ? Math.sign(this.targetX - this.x) * this.physics.walkSpeed * 1.4 : 0;
    this.vy = -(380 + Math.random() * 220) * power;
    this.set("fall");
  }

  /** Stay put for a while (talking, singing); hops, throws and errands still work. */
  hold(now: number, ms: number): void {
    this.holdUntil = now + ms;
    if (this.onArrive) return;
    this.resumeWalk = false;
    if (this.state === "walk") this.rest(now, 0);
  }

  get busy(): boolean {
    return this.onArrive !== null || this.state === "exercise" || this.state === "drag";
  }

  /** Walk (rolling) so his centre ends up at x, then call onArrive. */
  seek(x: number, onArrive: () => void): void {
    this.targetX = Math.max(this.minX, Math.min(this.maxX, x - this.w / 2));
    this.onArrive = onArrive;
    if (this.grounded) this.set("walk");
    else this.resumeWalk = true;
  }

  /** Stop rolling where he is and forget where he was going. */
  stop(now: number): void {
    this.onArrive = null;
    this.resumeWalk = false;
    if (this.state === "walk") this.rest(now, 1500);
  }

  /** Stand on a platform (the treadmill) with his centre at x. */
  standOn(x: number, platformHeight: number): void {
    this.onArrive = null;
    this.vx = this.vy = 0;
    this.x = x - this.w / 2;
    this.y = innerHeight - platformHeight - this.h;
    this.set("exercise");
  }

  /** Hop off the platform. */
  stepOff(): void {
    if (this.state !== "exercise") return;
    this.vx = -180;
    this.vy = -520;
    this.set("fall");
  }

  startDrag(px: number, py: number, now: number): void {
    this.onArrive = null;
    this.grab = { dx: px - this.x, dy: py - this.y, lastX: px, lastY: py, lastT: now };
    this.vx = this.vy = 0;
    this.resumeWalk = false;
    this.set("drag");
  }

  dragTo(px: number, py: number, now: number): void {
    const dt = Math.max(1, now - this.grab.lastT) / 1000;
    // Smoothed velocity so a quick flick at release becomes a throw.
    this.vx = this.vx * 0.5 + ((px - this.grab.lastX) / dt) * 0.5;
    this.vy = this.vy * 0.5 + ((py - this.grab.lastY) / dt) * 0.5;
    this.grab.lastX = px;
    this.grab.lastY = py;
    this.grab.lastT = now;

    // He can't be dragged through the outer screen edges; pushing into one squishes him.
    const wantX = px - this.grab.dx;
    const wantY = py - this.grab.dy;
    const { minX, maxX } = this;
    this.x = Math.max(minX, Math.min(maxX, wantX));
    this.y = Math.max(0, Math.min(this.floor, wantY));
    const x = wantX < minX ? wantX - minX : wantX > maxX ? wantX - maxX : 0;
    const y = wantY < 0 ? wantY : wantY > this.floor ? wantY - this.floor : 0;
    this.pressure = x || y ? { x, y } : null;
  }

  release(): void {
    this.pressure = null;
    // The mouse stopped before letting go: the throw fades out instead of keeping the last flick.
    const still = performance.now() - this.grab.lastT;
    if (still > RELEASE_GRACE_MS) {
      const keep = Math.exp(-(still - RELEASE_GRACE_MS) / RELEASE_FADE_MS);
      this.vx *= keep;
      this.vy *= keep;
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > MAX_THROW) {
      this.vx *= MAX_THROW / speed;
      this.vy *= MAX_THROW / speed;
    }
    this.set("fall");
  }

  /** Vanish and reappear on the floor at centre x (evil mode). */
  teleport(x: number): void {
    if (this.busy) return;
    this.x = Math.max(0, Math.min(innerWidth - this.w, x - this.w / 2));
    this.standingOn = null;
    this.container = null;
    this.y = this.floor;
    this.vx = this.vy = 0;
    this.resumeWalk = false;
    this.idleUntil = performance.now() + 3000;
    this.set("idle");
  }

  /** Bring him back on screen (tray "Call Verity back"). */
  recall(): void {
    this.onArrive = null;
    this.container = null;
    this.x = innerWidth - this.w - 80;
    this.y = -this.h;
    this.vx = this.vy = 0;
    this.resumeWalk = false;
    this.set("fall");
  }
}

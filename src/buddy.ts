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

export type State = "idle" | "walk" | "fall" | "drag" | "exercise";
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

  private targetX = 0;
  private resumeWalk = false;
  private onArrive: (() => void) | null = null;
  private idleUntil = 0;
  private holdUntil = 0;
  private grab = { dx: 0, dy: 0, lastX: 0, lastY: 0, lastT: 0 };
  /** While dragged into a screen edge: which edge and how many px past it. */
  pressure: { side: Side; depth: number } | null = null;

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

  private get floor(): number {
    return innerHeight - this.h;
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
        if (this.y < this.floor - 1) this.set("fall"); // screen resized under us
        else if (now >= this.idleUntil && now >= this.holdUntil) this.wander();
        return;
    }
  }

  private fall(dt: number, now: number): void {
    const maxX = innerWidth - this.w;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < 0 || this.x > maxX) {
      const side: Side = this.x < 0 ? "left" : "right";
      this.x = Math.max(0, Math.min(maxX, this.x));
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
    const maxX = innerWidth - this.w;
    const wanted = this.chooseTarget?.();
    const target = wanted ?? this.x + (Math.random() - 0.5) * 700;
    this.targetX = Math.max(0, Math.min(maxX, target));
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
    this.targetX = Math.max(0, Math.min(innerWidth - this.w, x - this.w / 2));
    this.onArrive = onArrive;
    if (this.grounded) this.set("walk");
    else this.resumeWalk = true;
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

    // He can't be dragged through the screen edges; pushing into one squishes him.
    const wantX = px - this.grab.dx;
    const wantY = py - this.grab.dy;
    const maxX = innerWidth - this.w;
    this.x = Math.max(0, Math.min(maxX, wantX));
    this.y = Math.max(0, Math.min(this.floor, wantY));
    const pushes: { side: Side; depth: number }[] = [
      { side: "left", depth: -wantX },
      { side: "right", depth: wantX - maxX },
      { side: "ceiling", depth: -wantY },
      { side: "floor", depth: wantY - this.floor },
    ];
    const hardest = pushes.reduce((a, b) => (b.depth > a.depth ? b : a));
    this.pressure = hardest.depth > 0 ? hardest : null;
  }

  release(): void {
    this.pressure = null;
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
    this.y = this.floor;
    this.vx = this.vy = 0;
    this.resumeWalk = false;
    this.idleUntil = performance.now() + 3000;
    this.set("idle");
  }

  /** Bring him back on screen (tray "Call Verity back"). */
  recall(): void {
    this.onArrive = null;
    this.x = innerWidth - this.w - 80;
    this.y = -this.h;
    this.vx = this.vy = 0;
    this.resumeWalk = false;
    this.set("fall");
  }
}

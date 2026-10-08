// Things on the desktop besides Verity: food that drops in, puke droplets that
// splat into puddles, and the treadmill. All are plain DOM elements that ignore
// the mouse (clicks fall through to the desktop).

const GRAVITY = 2200;
const BOUNCE = 0.3;

/** A small physics object: falls, bounces off the floor and walls, then rests. */
export class Prop {
  readonly el: HTMLElement;
  vx: number;
  vy: number;
  landed = false;
  gone = false;

  constructor(
    stage: HTMLElement,
    className: string,
    public x: number,
    public y: number,
    velocity: [number, number],
    private readonly onLand?: (p: Prop) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = className;
    stage.append(this.el);
    [this.vx, this.vy] = velocity;
    this.place();
  }

  get width(): number {
    return this.el.offsetWidth;
  }

  get height(): number {
    return this.el.offsetHeight;
  }

  step(dt: number): void {
    if (this.landed || this.gone) return;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const half = this.width / 2;
    if (this.x < half || this.x > innerWidth - half) {
      this.x = Math.max(half, Math.min(innerWidth - half, this.x));
      this.vx = -this.vx * BOUNCE;
    }
    const floor = innerHeight - this.height;
    if (this.y >= floor) {
      this.y = floor;
      if (this.vy > 300 && !this.onLand) {
        this.vy = -this.vy * BOUNCE;
        this.vx *= 0.7;
      } else {
        this.vx = this.vy = 0;
        this.landed = true;
        this.onLand?.(this);
      }
    }
    this.place();
  }

  private place(): void {
    this.el.style.transform = `translate(${this.x - this.width / 2}px, ${this.y}px)`;
  }

  /** Remove after an optional CSS exit animation class. */
  remove(exitClass?: string, ms = 0): void {
    this.gone = true;
    if (exitClass) this.el.classList.add(exitClass);
    window.setTimeout(() => this.el.remove(), ms);
  }
}

export const FOODS = ["🍔", "🍕", "🍩", "🍗", "🍟", "🌭", "🧁", "🍰"];

export function spawnFood(stage: HTMLElement): Prop {
  const p = new Prop(stage, "food", 60 + Math.random() * (innerWidth - 120), -60, [Math.random() * 300 - 150, 0]);
  p.el.textContent = FOODS[Math.floor(Math.random() * FOODS.length)];
  return p;
}

/** One droplet of puke; it splats into a puddle that fades away. */
export function spawnPuke(stage: HTMLElement, x: number, y: number, dir: number): Prop {
  const p = new Prop(
    stage,
    "puke",
    x,
    y,
    [dir * (120 + Math.random() * 260), -(80 + Math.random() * 260)],
    (drop) => {
      drop.el.classList.add("puddle");
      drop.remove("fade", 3200);
    },
  );
  p.el.style.setProperty("--hue", `${70 + Math.random() * 30}`);
  return p;
}

export class Treadmill {
  readonly el: HTMLElement;
  readonly width = 240;
  readonly height = 28; // top of the belt Verity stands on
  used = false;

  constructor(
    stage: HTMLElement,
    public x: number,
  ) {
    this.el = document.createElement("div");
    this.el.className = "treadmill";
    this.el.innerHTML = '<div class="tm-belt"></div><div class="tm-post"></div><div class="tm-bar"></div>';
    this.x = Math.max(this.width / 2 + 10, Math.min(innerWidth - this.width / 2 - 10, x));
    this.el.style.left = `${this.x - this.width / 2}px`;
    stage.append(this.el);
  }

  setRunning(on: boolean): void {
    this.el.classList.toggle("running", on);
  }

  remove(): void {
    this.el.classList.add("fade");
    window.setTimeout(() => this.el.remove(), 800);
  }
}

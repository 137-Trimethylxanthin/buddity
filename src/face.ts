import * as THREE from "three";
import { Mold } from "./mold";
import { BallBody } from "./ball";
import { BlobBody } from "./blob";
import type { Side, State } from "./buddy";
import type { Mood } from "./lines";
import type { Skin } from "./skins";
import { buildAccessory, disposeAccessory } from "./accessories";
import { accessory, type AccessoryId, type Slot } from "./wardrobe";

// The 3D character: scene, lights, a squash-and-stretch spring shared by every
// body, and the expression state (eyes, mouth, mood). The body itself — the
// ball — builds its geometry and animates itself.

export type Eyes = "open" | "closed" | "happy" | "squeeze" | "dizzy";
export type Mouth = "smile" | "open" | "o";

export interface Look {
  skin: Skin;
  mood: Mood;
  eyes: Eyes;
  mouth: Mouth;
  grin: number;
}

export interface Motion {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  state: State;
  /** Px rolled on the spot this frame: positive rolls him towards you, negative away. */
  spin?: number;
}

export interface Body {
  readonly object: THREE.Object3D;
  /** Half width and height in world units, for keeping the squashed side on the surface. */
  readonly halfExtents: [number, number];
  /** Where accessories go, per wardrobe slot. */
  readonly anchors: Record<Slot, THREE.Object3D>;
  setLook(l: Look): void;
  /** Multiply the body colour (e.g. green when sick); null restores it. */
  setTint(color: THREE.Color | null): void;
  update(dt: number, m: Motion, look: THREE.Quaternion): void;
  impact(speed: number): void;
  dispose(): void;
}

export const BALL_FILL = 0.93; // share of the hit box the ball's diameter takes up
const CANVAS_PAD = 1.6; // the canvas is bigger than the hit box so squash/stretch isn't clipped
const LOOK_YAW = 0.45; // max radians he turns towards the cursor
const LOOK_PITCH = 0.35;

const SPRING_K = 320;
const SPRING_DAMP = 9;
const MAX_SQUASH = 0.45;
const MAX_STRETCH = -0.3;
const CONTACT_S = 0.5; // how long after a hit the body stays pressed against that surface
const CORNER_S = 0.08; // two hits on neighbouring edges this close together squash him into the corner

const CREEPY_TINT = new THREE.Color(0.75, 0.5, 0.45); // drained
const SICK_TINT = new THREE.Color(0.5, 1, 0.4);

const SIDE_AXIS: Record<Side, { angle: number; contact: [number, number] }> = {
  floor: { angle: 0, contact: [0, -1] },
  ceiling: { angle: 0, contact: [0, 1] },
  left: { angle: Math.PI / 2, contact: [-1, 0] },
  right: { angle: Math.PI / 2, contact: [1, 0] },
};

/** What he's pressed against: a screen edge or both hands. snap skips the spring (frame-exact, for petting). */
export type Press = { side: Side | "squeeze"; amount: number; snap?: boolean };

/** Squash axis for a contact direction: squashing towards the floor is angle 0. */
function axisOf([cx, cy]: [number, number]): number {
  return Math.atan2(cx, -cy);
}

export class Face {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // root (contact offset + squash direction) › squash (scale) › unrotate › body
  private readonly root = new THREE.Group();
  private readonly squash = new THREE.Group();
  private readonly unrotate = new THREE.Group();
  private readonly look = new THREE.Quaternion();
  private readonly ambient = new THREE.HemisphereLight();
  private readonly key = new THREE.DirectionalLight();
  private readonly rim = new THREE.DirectionalLight();
  private body!: Body;

  private skin!: Skin;
  private mood: Mood = "friendly";
  private grin = 1;
  private mouth: Mouth = "smile";
  private blinking = false;
  private eyesOverride: { eyes: Eyes; until: number } | null = null;
  private grinTimer = 0;
  private sick = false;
  private time = 0;

  // Squash spring: s > 0 squashes along the axis, s < 0 stretches.
  private s = 0;
  private sv = 0;
  private axis = 0;
  private contact: [number, number] = [0, -1];
  private contactUntil = 0;
  private lastHit = -Infinity;
  private press: Press | null = null;
  private readonly mold = new Mold();
  private push: [number, number] | null = null; // px pushed into the screen edges (x right, y down)
  private readonly worn = new Map<AccessoryId, THREE.Object3D>();

  constructor(
    private readonly el: HTMLElement,
    private readonly baseSize: number,
    skin: Skin,
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    el.append(this.renderer.domElement);
    this.camera.position.z = 10;

    this.scene.add(this.ambient, this.key, this.rim);
    this.light("friendly");

    this.scene.add(this.root);
    this.root.add(this.squash);
    this.squash.add(this.unrotate);

    this.setSkin(skin);
    this.scheduleBlink();
  }

  /** Pixels per world unit: the base ball's radius on screen. */
  private get ppu(): number {
    return (this.baseSize * BALL_FILL) / 2;
  }

  setSkin(skin: Skin): void {
    this.skin = skin;
    const [sx, sy] = skin.shape;
    const w = this.baseSize * sx;
    const h = this.baseSize * sy;
    const cw = w * CANVAS_PAD;
    const ch = h * CANVAS_PAD;
    this.renderer.setSize(cw, ch);
    const canvas = this.renderer.domElement;
    canvas.style.left = `${(w - cw) / 2}px`;
    canvas.style.top = `${(h - ch) / 2}px`;
    Object.assign(this.camera, {
      left: -cw / 2 / this.ppu,
      right: cw / 2 / this.ppu,
      top: ch / 2 / this.ppu,
      bottom: -ch / 2 / this.ppu,
    });
    this.camera.updateProjectionMatrix();

    if (this.body) {
      for (const obj of this.worn.values()) obj.removeFromParent(); // keep them for the new body
      this.unrotate.remove(this.body.object);
      this.body.dispose();
    }
    this.body = skin.body === "blob" ? new BlobBody(skin, this.ppu) : new BallBody(skin, this.ppu);
    this.body.object.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) this.mold.apply(m);
    });
    this.unrotate.add(this.body.object);
    for (const [id, obj] of this.worn) this.body.anchors[accessory(id)!.slot].add(obj); // dress the new body
    this.refresh();
  }

  /** Put on exactly these accessories (one per slot, see wardrobe.ts). */
  setWardrobe(ids: AccessoryId[]): void {
    for (const [id, obj] of this.worn) {
      if (ids.includes(id)) continue;
      obj.removeFromParent();
      disposeAccessory(obj);
      this.worn.delete(id);
    }
    for (const id of ids) {
      if (this.worn.has(id)) continue;
      const obj = buildAccessory(id);
      // Molds into walls with him, so a hat doesn't poke through the ceiling.
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) this.mold.apply(m);
      });
      this.worn.set(id, obj);
      this.body.anchors[accessory(id)!.slot].add(obj);
    }
  }

  private refresh(): void {
    const override = this.eyesOverride && this.time < this.eyesOverride.until ? this.eyesOverride.eyes : null;
    // Evil mode never blinks.
    const blink = this.blinking && this.skin.eyes === "open" && this.mood !== "creepy";
    const eyes = override ?? (blink ? "closed" : this.skin.eyes);
    this.body.setLook({ skin: this.skin, mood: this.mood, eyes, mouth: this.mouth, grin: this.grin });
    this.body.setTint(this.sick ? SICK_TINT : this.mood === "creepy" ? CREEPY_TINT : null);
  }

  /** Turn towards a position given in window CSS pixels. */
  lookAt(x: number, y: number): void {
    const box = this.el.getBoundingClientRect();
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height / 2);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.look.setFromEuler(new THREE.Euler(clamp(dy / 400) * LOOK_PITCH, clamp(dx / 400) * LOOK_YAW, 0));
  }

  /** A hit against a screen edge: squash against it, harder for faster hits. */
  impact(side: Side, speed: number): void {
    const { angle, contact } = SIDE_AXIS[side];
    const [px, py] = this.contact;
    if (this.time - this.lastHit < CORNER_S && px * contact[0] + py * contact[1] === 0) {
      // Hit two neighbouring edges at once: squash diagonally into the corner.
      const c: [number, number] = [(px + contact[0]) / Math.SQRT2, (py + contact[1]) / Math.SQRT2];
      this.contact = c;
      this.axis = axisOf(c);
    } else {
      this.axis = angle;
      this.contact = contact;
    }
    this.lastHit = this.time;
    this.contactUntil = this.time + CONTACT_S;
    this.sv += Math.min(10, speed / 200) * this.skin.squish;
    this.body.impact(speed);
  }

  /**
   * Squash him on purpose: pushed into a screen edge or corner while dragged,
   * patted, or squeezed by holding the mouse on him. amount is 0..1; null lets
   * go (he springs back).
   */
  setPress(press: Press | null): void {
    this.press = press;
  }

  /** Pushed this far (px, x right, y down) into the screen edges while dragged: he molds into them. */
  setPush(push: [number, number] | null): void {
    this.push = push;
  }

  /** Green and queasy after being shaken. */
  setSick(on: boolean): void {
    this.sick = on;
    this.refresh();
  }

  /** Advance one frame and render. */
  update(dt: number, m: Motion): void {
    this.time += dt;
    this.body.update(dt, m, this.look);
    this.updateSquash(dt, m);
    if (this.eyesOverride && this.time >= this.eyesOverride.until) {
      this.eyesOverride = null;
      this.refresh();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateSquash(dt: number, m: Motion): void {
    if (this.press && this.press.side !== "squeeze") {
      const { angle, contact } = SIDE_AXIS[this.press.side];
      this.axis = angle;
      this.contact = contact;
      this.contactUntil = this.time + 0.05;
    }
    const touching = this.time < this.contactUntil;
    let target = 0;
    const speed = Math.hypot(m.vx, m.vy);
    if (this.press) {
      if (this.press.side === "squeeze") this.axis = 0;
      target = this.press.amount * MAX_SQUASH;
    } else if (m.state === "fall" && !touching && speed > 500) {
      // Stretch along the direction of flight.
      this.axis = Math.atan2(-m.vx, -m.vy);
      target = -Math.min(0.2, (speed - 500) / 6000);
    } else if (m.state === "drag") {
      this.axis = 0;
      target = -0.08; // hangs a little when held
    } else if (m.state === "walk" || m.state === "exercise") {
      target = 0.04 * Math.abs(Math.sin(this.time * (m.state === "exercise" ? 16 : 9))); // wobbles as he moves
    } else if (m.state === "idle") {
      target = 0.03 * Math.sin(this.time * 2.4); // breathing
    }
    if (m.state !== "fall" && !touching && !this.press) {
      this.axis = 0;
      this.contact = [0, -1];
    }

    if (this.push) target = 0; // molding instead, below
    if (this.press?.snap) {
      this.s = target;
      this.sv = 0;
    } else {
      const accel = -SPRING_K * (this.s - target) - SPRING_DAMP * this.sv;
      this.sv += accel * dt;
      this.s = Math.max(MAX_STRETCH, Math.min(MAX_SQUASH, this.s + this.sv * dt));
    }

    this.root.rotation.z = this.axis;
    this.unrotate.rotation.z = -this.axis;
    this.squash.scale.set(1 + this.s * 0.6, 1 - this.s, 1 + this.s * 0.6);

    // Keep the squashed side pressed against the surface it's touching.
    const grounded = m.state === "idle" || m.state === "walk" || m.state === "exercise";
    if (touching || grounded) {
      // The squashed body is an ellipse: short along the contact direction, wide across
      // it. Shift it so it still touches each wall it's pressed against (both, in a corner).
      const [cx, cy] = this.contact;
      const [hx, hy] = this.body.halfExtents;
      const along = Math.hypot(cx * hx, cy * hy) * (1 - this.s);
      const across = Math.hypot(cy * hx, cx * hy) * (1 + this.s * 0.6);
      const reach = (n: number, t: number) => Math.hypot(along * n, across * t);
      const ox = cx ? Math.sign(cx) * (hx - reach(cx, cy)) : 0;
      const oy = cy ? Math.sign(cy) * (hy - reach(cy, cx)) : 0;
      this.root.position.set(ox, oy, 0);
    } else {
      this.root.position.set(0, 0, 0);
    }
    this.updateMold();
  }

  /** Pushed into edges: slide into them and flatten against each wall, bulging a little. */
  private updateMold(): void {
    if (!this.push) return this.mold.clear();
    // The walls are the edges of his box (the screen edges he's pinned to), in world units.
    const bx = (this.baseSize * this.skin.shape[0]) / 2 / this.ppu;
    const by = (this.baseSize * this.skin.shape[1]) / 2 / this.ppu;
    const cap = 0.55 * Math.min(bx, by);
    let px = this.push[0] / this.ppu;
    let py = -this.push[1] / this.ppu; // world y is up
    const len = Math.hypot(px, py);
    if (len > cap) {
      px *= cap / len;
      py *= cap / len;
    }
    // He turns his face away from the walls he's squashed into.
    const k = Math.min(1, len / cap);
    this.look.setFromEuler(
      new THREE.Euler(-Math.sign(this.push[1]) * LOOK_PITCH * k, -Math.sign(this.push[0]) * LOOK_YAW * k, 0),
    );
    this.axis = 0;
    this.root.rotation.z = 0;
    this.unrotate.rotation.z = 0;
    this.root.position.set(px, py, 0);
    const bulge = 1 + 0.18 * k;
    this.squash.scale.set(bulge, bulge, bulge);
    this.mold.set(px < 0 ? -bx : null, px > 0 ? bx : null, py < 0 ? -by : null, py > 0 ? by : null);
  }

  /** Normal daylight, or evil mode's red light from below (flashlight-under-the-chin). */
  private light(mood: Mood): void {
    const evil = mood === "creepy";
    this.ambient.color.set(evil ? 0x6a6058 : 0xfff6dc);
    this.ambient.groundColor.set(evil ? 0x200000 : 0x5c4500);
    this.ambient.intensity = evil ? 0.9 : 1.6;
    this.key.color.set(evil ? 0xff5030 : 0xffffff);
    this.key.intensity = evil ? 1.3 : 1.8;
    this.key.position.set(evil ? 0.4 : -2, evil ? -3 : 3, 4);
    this.rim.color.set(evil ? 0x8a0000 : 0xffd25a);
    this.rim.intensity = evil ? 1.2 : 0.9;
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.light(mood);
    this.grin = 1;
    this.el.classList.toggle("creepy", mood === "creepy");
    window.clearInterval(this.grinTimer);
    if (mood === "creepy") {
      // The grin keeps getting wider the longer creepy mode lasts.
      this.grinTimer = window.setInterval(() => {
        this.grin = Math.min(1.18, this.grin + 0.02);
        this.refresh();
      }, 4000);
    }
    this.refresh();
  }

  setMouth(mouth: Mouth): void {
    if (mouth === this.mouth) return;
    this.mouth = mouth;
    this.refresh();
  }

  /** Show an expression for a moment (e.g. squeezed eyes after a hard hit). */
  flashEyes(eyes: Eyes, ms: number): void {
    const until = this.time + ms / 1000;
    if (this.eyesOverride?.eyes === eyes && this.time < this.eyesOverride.until) {
      this.eyesOverride.until = Math.max(this.eyesOverride.until, until);
      return;
    }
    this.eyesOverride = { eyes, until };
    this.refresh();
  }

  setHover(on: boolean): void {
    this.el.classList.toggle("hover", on);
  }

  giggle(): void {
    this.play("giggle", 750);
  }

  twitch(): void {
    this.play("twitch", 550);
  }

  private play(cls: string, ms: number): void {
    this.el.classList.remove(cls);
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add(cls);
    window.setTimeout(() => this.el.classList.remove(cls), ms);
  }

  private scheduleBlink(): void {
    const blink = (then: () => void) => {
      this.blinking = true;
      this.refresh();
      window.setTimeout(() => {
        this.blinking = false;
        this.refresh();
        then();
      }, 110);
    };
    window.setTimeout(() => {
      // Sometimes a quick double blink.
      if (Math.random() < 0.25) blink(() => window.setTimeout(() => blink(() => this.scheduleBlink()), 140));
      else blink(() => this.scheduleBlink());
    }, 2000 + Math.random() * 4500);
  }
}

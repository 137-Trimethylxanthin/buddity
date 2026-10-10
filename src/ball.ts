import * as THREE from "three";
import type { Body, Look, Motion } from "./face";
import type { Skin } from "./skins";
import type { Slot } from "./wardrobe";

// The classic Verity: a ball. His flat face (the public-domain vector, 154×154
// viewBox) is projected onto a sphere texture, so seen head-on he looks exactly
// like the original, and when the ball rolls or turns the face moves with it.

const VIEW = 154;
const CENTER = 77;
const RADIUS = 76.6;
const EYES: [number, number][] = [
  [61.8, 64.6],
  [92.4, 64.6],
];
const CHEEKS: [number, number][] = [
  [44, 86],
  [110, 86],
];
const MOUTH = new Path2D(
  "m124.7 85.7q4 0.6 5.1 0 0.2-2-2.4-3.8-2.7-1.8-5.5-0.9-0.7 1.8 1.3 3.8-5.8 7.9-14.8 13.1-13.5 7.9-32 8.4-16.5 0.4-30.8-8-10.1-6-15.9-13.3 1.4-1.9 1.2-3.5-0.7-0.3-2.3-0.3-1.4 0-2.7 0.8-1.3 0.8-1.8 2.1-0.5 1.2 0 2.2 1.4 0.5 4.3-0.6 8 12.2 19.5 19.3 12.9 8.1 28.1 8 15.1 0 27.7-7.6 12.5-7.6 21-19.7z",
);
const MOUTH_OPEN = new Path2D("M38 87 Q77 101 116 87 Q110 123 77 125 Q44 123 38 87 Z");
const MOUTH_O = new Path2D();
MOUTH_O.ellipse(77, 104, 9, 11.5, 0, 0, Math.PI * 2);
// Creepy grin, drawn in a 200-unit space and scaled onto the 154 face.
const GRIN = new Path2D("M28 108 Q100 196 172 108 Q100 136 28 108 Z");
const TEETH = new Path2D(
  "M46 118 L46 132 M64 124 L64 144 M82 127 L82 152 M100 128 L100 155 M118 127 L118 152 M136 124 L136 144 M154 118 L154 132",
);
const MOUTH_INSIDE = "#3a0a0a";
const TONGUE = "#e0505e";

const FEATURE_RES = 1024;
const TEX_W = 1024;
const TEX_H = 512;
const TEXTURE_CACHE = 24;

function drawEyes(g: CanvasRenderingContext2D, l: Look): void {
  const creepy = l.mood === "creepy";
  g.fillStyle = g.strokeStyle = l.skin.ink;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 2.6;
  EYES.forEach(([x, y], i) => {
    g.beginPath();
    switch (l.eyes) {
      case "open":
      case "closed": {
        if (creepy) {
          // Evil: empty black sockets with a tiny red pupil. He doesn't blink.
          g.ellipse(x, y - 1, 10, 15, (i === 0 ? 1 : -1) * 0.3, 0, Math.PI * 2);
          g.fill();
          const glow = g.createRadialGradient(x, y + 1, 0, x, y + 1, 4.5);
          glow.addColorStop(0, "#fff2c0");
          glow.addColorStop(0.3, "#ff2a1a");
          glow.addColorStop(1, "rgba(255, 0, 0, 0)");
          g.fillStyle = glow;
          g.beginPath();
          g.arc(x, y + 1, 4.5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = l.skin.ink;
          break;
        }
        const ry = 9.1 * (l.eyes === "closed" ? 0.12 : 1);
        g.ellipse(x, y, 5.5, ry, 0, 0, Math.PI * 2);
        g.fill();
        if (l.skin.face === "tired" && l.eyes === "open") {
          // Heavy eyelid over the top half.
          g.fillStyle = l.skin.color;
          g.fillRect(x - 7, y - 11, 14, 10);
          g.fillStyle = l.skin.ink;
          g.lineWidth = 1.8;
          g.beginPath();
          g.moveTo(x - 6.5, y - 1);
          g.lineTo(x + 6.5, y - 1);
          g.stroke();
        }
        break;
      }
      case "happy": // ^ ^
        g.moveTo(x - 6, y + 3);
        g.quadraticCurveTo(x, y - 7, x + 6, y + 3);
        g.stroke();
        break;
      case "squeeze": {
        // > <
        const d = i === 0 ? 1 : -1;
        g.moveTo(x - 5 * d, y - 6);
        g.lineTo(x + 4 * d, y);
        g.lineTo(x - 5 * d, y + 6);
        g.stroke();
        break;
      }
      case "dizzy": // spirals
        g.lineWidth = 1.6;
        for (let a = 0; a < Math.PI * 5; a += 0.2) {
          const r = 0.8 + a * 0.45;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (a === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
        break;
    }
  });

  if (l.skin.face === "freaky" && !creepy) {
    // One eyebrow cocked way up, the other flat. 🤨
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(54, 47);
    g.quadraticCurveTo(61, 39, 69, 45);
    g.moveTo(85, 53);
    g.lineTo(99, 52);
    g.stroke();
  }
  if (l.skin.face === "tired") {
    // Dark bags under the eyes.
    g.strokeStyle = "rgba(70, 40, 90, 0.55)";
    g.lineWidth = 2.2;
    for (const [x, y] of EYES) {
      g.beginPath();
      g.moveTo(x - 6, y + 11);
      g.quadraticCurveTo(x, y + 16, x + 6, y + 11);
      g.stroke();
    }
  }
  if (l.skin.blush) {
    g.fillStyle = l.skin.blush;
    for (const [x, y] of CHEEKS) {
      g.beginPath();
      g.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Freakity's lopsided smirk with the tongue poking out of one corner. 😜 */
function drawSmirk(g: CanvasRenderingContext2D, l: Look): void {
  g.fillStyle = TONGUE;
  g.beginPath();
  g.ellipse(106, 104, 7, 9, -0.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = l.skin.ink;
  g.lineWidth = 1.5;
  g.stroke();
  g.beginPath();
  g.moveTo(104, 99);
  g.lineTo(108, 107);
  g.stroke();
  g.lineWidth = 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(52, 100);
  g.quadraticCurveTo(84, 110, 114, 92);
  g.stroke();
}

/** Goonity's flat, exhausted mouth. */
function drawTiredMouth(g: CanvasRenderingContext2D, l: Look): void {
  g.strokeStyle = l.skin.ink;
  g.lineWidth = 3.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(62, 104);
  g.quadraticCurveTo(77, 101, 92, 105);
  g.stroke();
}

function drawMouth(g: CanvasRenderingContext2D, l: Look): void {
  g.save();
  if (l.mood === "creepy") {
    g.translate(CENTER, 0);
    g.scale(l.grin, 1);
    g.translate(-CENTER, 0);
    g.translate(0, 4);
    g.scale(0.77, 0.77);
    if (l.mouth !== "smile") {
      // Talking: the grin opens wider.
      g.translate(0, 108);
      g.scale(1, l.mouth === "open" ? 1.4 : 1.2);
      g.translate(0, -108);
    }
    g.fillStyle = g.strokeStyle = l.skin.ink;
    g.fill(GRIN);
    g.lineWidth = 4;
    g.lineJoin = "round";
    g.stroke(GRIN);
    g.strokeStyle = "#fff6c9";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.stroke(TEETH);
  } else if (l.mouth === "smile") {
    if (l.skin.face === "freaky") drawSmirk(g, l);
    else if (l.skin.face === "tired") drawTiredMouth(g, l);
    else {
      g.fillStyle = l.skin.ink;
      g.fill(MOUTH);
    }
  } else {
    const shape = l.mouth === "open" ? MOUTH_OPEN : MOUTH_O;
    g.fillStyle = MOUTH_INSIDE;
    g.fill(shape);
    g.save();
    g.clip(shape);
    g.fillStyle = TONGUE;
    g.beginPath();
    if (l.mouth === "open") g.ellipse(77, 124, 20, 9, 0, 0, Math.PI * 2);
    else g.ellipse(77, 114, 7, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.strokeStyle = l.skin.ink;
    g.lineWidth = 2.2;
    g.lineJoin = "round";
    g.stroke(shape);
  }
  g.restore();
}

/** Draws the flat face features (no background) as the original vector would look. */
/** Obesity's small face: dot eyes up high and a little flat mouth. */
function drawDotFace(g: CanvasRenderingContext2D, l: Look): void {
  const creepy = l.mood === "creepy";
  g.fillStyle = g.strokeStyle = l.skin.ink;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const [i, x] of [66, 88].entries()) {
    const y = 42;
    g.beginPath();
    g.lineWidth = 1.8;
    switch (l.eyes) {
      case "open":
      case "closed":
        g.ellipse(x, y, creepy ? 3 : 3.9, (creepy ? 3.9 : 5) * (l.eyes === "closed" ? 0.15 : 1), 0, 0, Math.PI * 2);
        g.fill();
        break;
      case "happy":
        g.moveTo(x - 4, y + 2);
        g.quadraticCurveTo(x, y - 4, x + 4, y + 2);
        g.stroke();
        break;
      case "squeeze": {
        const d = i === 0 ? 1 : -1;
        g.moveTo(x - 3.5 * d, y - 4);
        g.lineTo(x + 3 * d, y);
        g.lineTo(x - 3.5 * d, y + 4);
        g.stroke();
        break;
      }
      case "dizzy":
        g.lineWidth = 1.1;
        for (let a = 0; a < Math.PI * 4; a += 0.25) {
          const r = 0.5 + a * 0.35;
          if (a === 0) g.moveTo(x + r, y);
          else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.stroke();
        break;
    }
  }
  g.beginPath();
  if (creepy) {
    g.lineWidth = 2;
    g.moveTo(77 - 16 * l.grin, 54);
    g.quadraticCurveTo(77, 66 + (l.mouth === "smile" ? 0 : 4), 77 + 16 * l.grin, 54);
    g.stroke();
  } else if (l.mouth === "smile") {
    g.lineWidth = 1.8;
    g.moveTo(70, 57);
    g.quadraticCurveTo(77, 55.5, 84, 57); // the little unimpressed mouth
    g.stroke();
  } else {
    g.fillStyle = MOUTH_INSIDE;
    g.ellipse(77, 57, l.mouth === "open" ? 6 : 3.5, l.mouth === "open" ? 4.5 : 4.5, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 1.2;
    g.stroke();
  }
}

function drawFeatures(l: Look): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = FEATURE_RES;
  const g = canvas.getContext("2d")!;
  g.scale(FEATURE_RES / VIEW, FEATURE_RES / VIEW);
  if (l.skin.face === "dots") {
    drawDotFace(g, l);
  } else {
    drawEyes(g, l);
    drawMouth(g, l);
  }
  return g.getImageData(0, 0, FEATURE_RES, FEATURE_RES).data;
}

/**
 * Bakes an equirectangular sphere texture. Each texel on the front hemisphere is
 * projected straight onto the flat face (orthographically), so the ball shows the
 * original design when it faces the camera.
 */
function bakeTexture(l: Look): THREE.CanvasTexture {
  const features = drawFeatures(l);
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext("2d")!;
  g.fillStyle = l.skin.color;
  g.fillRect(0, 0, TEX_W, TEX_H);
  const img = g.getImageData(0, 0, TEX_W, TEX_H);
  const out = img.data;
  const toFeature = FEATURE_RES / VIEW;

  // three.js SphereGeometry: phi = u·2π, theta = v·π from the top;
  // x = -cos φ sin θ, y = cos θ, z = sin φ sin θ. The camera looks down -z.
  for (let j = 0; j < TEX_H; j++) {
    const theta = (Math.PI * (j + 0.5)) / TEX_H;
    const sinT = Math.sin(theta);
    const y = Math.cos(theta);
    for (let i = 0; i < TEX_W / 2; i++) {
      const phi = (2 * Math.PI * (i + 0.5)) / TEX_W;
      if (Math.sin(phi) * sinT <= 0) continue; // back of the ball
      const x = -Math.cos(phi) * sinT;
      const fx = Math.floor((CENTER + x * RADIUS) * toFeature);
      const fy = Math.floor((CENTER - y * RADIUS) * toFeature);
      const k = (fy * FEATURE_RES + fx) * 4;
      const a = features[k + 3] / 255;
      if (a === 0) continue;
      const o = (j * TEX_W + i) * 4;
      out[o] = out[o] * (1 - a) + features[k] * a;
      out[o + 1] = out[o + 1] * (1 - a) + features[k + 1] * a;
      out[o + 2] = out[o + 2] * (1 - a) + features[k + 2] * a;
    }
  }
  g.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Baked face textures per expression, least recently used dropped first. */
export class FaceTextures {
  private readonly cache = new Map<string, THREE.CanvasTexture>();

  get(l: Look): THREE.CanvasTexture {
    const key = `${l.mood}|${l.eyes}|${l.mouth}|${l.grin.toFixed(2)}`;
    let tex = this.cache.get(key);
    if (tex) {
      this.cache.delete(key); // move to the back of the LRU order
    } else {
      tex = bakeTexture(l);
      if (this.cache.size >= TEXTURE_CACHE) {
        const [oldestKey, oldest] = this.cache.entries().next().value!;
        oldest.dispose();
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, tex);
    return tex;
  }

  dispose(): void {
    for (const tex of this.cache.values()) tex.dispose();
    this.cache.clear();
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

export class BallBody implements Body {
  readonly object = new THREE.Group(); // skin proportions
  readonly halfExtents: [number, number];
  readonly anchors: Record<Slot, THREE.Object3D>;
  readonly hand: THREE.Object3D;
  readonly marks: Body["marks"];
  private readonly held: THREE.Group; // upright, turning with his look
  private readonly ball: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly textures = new FaceTextures();
  private readonly step = new THREE.Quaternion();

  constructor(
    private readonly skin: Skin,
    private readonly ppu: number,
  ) {
    const [sx, sy] = skin.shape;
    this.halfExtents = [sx, sy];
    this.material = new THREE.MeshStandardMaterial({ metalness: 0, roughness: skin.roughness });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.material);
    this.object.scale.set(sx, sy, (sx + sy) / 2);
    this.object.add(this.ball);
    // Everything he wears is stuck to the ball and rolls with it.
    const neck = new THREE.Group(); // under his smile, on the front of the ball
    neck.position.set(0, -0.72, 0.72);
    neck.rotation.x = -0.75;
    this.ball.add(neck);
    this.anchors = { head: this.ball, face: this.ball, neck };
    // The mic: below one corner of his smile, leaning in so its head is at his mouth.
    // It doesn't roll with the ball: it only turns where his face turns to look.
    this.held = new THREE.Group();
    this.hand = new THREE.Group();
    this.hand.position.set(0.38, -0.72, 0.8);
    this.hand.rotation.set(0.35, 0, 0.55);
    this.held.add(this.hand);
    this.object.add(this.held);
    // The top of his head and a belt round his middle stay put while he rolls; his mouth goes round with his face.
    const mark = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    this.marks = {
      head: mark(this.object, 0, 1, 0),
      mouth: mark(this.ball, 0, -0.33, 0.94),
      beltLeft: mark(this.object, -0.95, -0.42, 0),
      beltRight: mark(this.object, 0.95, -0.42, 0),
    };
  }

  setLook(l: Look): void {
    this.material.map = this.textures.get(l);
    this.material.needsUpdate = true;
  }

  /** Rolls while moving or spinning on the spot; otherwise turns to face where it's looking. */
  update(dt: number, m: Motion, look: THREE.Quaternion): void {
    this.held.quaternion.slerp(look, 1 - Math.exp(-dt * 5));
    const radiusPx = this.ppu * this.skin.shape[0];
    if (m.spin) {
      this.step.setFromAxisAngle(X_AXIS, m.spin / radiusPx);
      this.ball.quaternion.premultiply(this.step);
      return;
    }
    if (m.state === "walk" || m.state === "fall" || m.state === "exercise") {
      this.step.setFromAxisAngle(Z_AXIS, -m.dx / radiusPx);
      this.ball.quaternion.premultiply(this.step);
      if (m.state === "fall") {
        this.step.setFromAxisAngle(X_AXIS, (m.dy / radiusPx) * 0.35);
        this.ball.quaternion.premultiply(this.step);
      }
    } else {
      this.ball.quaternion.slerp(look, 1 - Math.exp(-dt * 5));
    }
  }

  impact(): void {}

  setTint(color: THREE.Color | null): void {
    this.material.color.set(color ?? 0xffffff);
  }

  dispose(): void {
    this.textures.dispose();
    this.ball.geometry.dispose();
    this.material.dispose();
  }
}

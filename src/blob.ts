import * as THREE from "three";
import { BALL_FILL, type Body, type Look, type Motion } from "./face";
import { FaceTextures } from "./ball";
import type { Skin } from "./skins";
import type { Slot } from "./wardrobe";

// Obesity: a fat yellow blob. A sphere reshaped into a dumpling: wider at the
// bottom, a chin roll and a belly roll, the belly pushing out at the front with
// a navel, a flat base, and two tiny arms. He can't roll, so he waddles,
// tumbles when thrown hard, and wobbles back upright.

const BASE_Y = -0.9; // where the bottom starts flattening (unit-sphere space)
const BASE_SQUASH = 0.55; // how much the bottom cap is flattened
const BOTTOM_Y = BASE_Y - (1 + BASE_Y) * BASE_SQUASH; // lowest point after flattening
const STEP_PX = 18; // waddle cycle length factor
const TUMBLE_SPEED = 700; // px/s sideways throw that sends him spinning
const NAVEL = new THREE.Vector3(0, -0.36, 0.93).normalize();

function bump(y: number, centre: number, width: number): number {
  return Math.exp(-(((y - centre) / width) ** 2));
}

/** A unit sphere pushed and pulled into Obesity's shape. UVs are kept, so the face texture still fits. */
function blobGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const front = Math.max(0, v.z);
    let r = 1;
    r += 0.045 * bump(v.y, 0.2, 0.09) * (0.4 + 0.6 * front); // the head overhangs a little...
    r -= 0.06 * bump(v.y, 0.08, 0.075) * (0.35 + 0.65 * front); // ...into a soft chin roll
    r += 0.14 * front * front * bump(v.y, -0.5, 0.35); // belly pushes out
    r -= 0.03 * Math.exp(-(1 - v.dot(NAVEL)) / 0.0008); // small navel
    const widen = 1 + 0.07 * (1 - v.y); // wider towards the bottom
    let y = v.y * r;
    if (y < BASE_Y) y = BASE_Y + (y - BASE_Y) * BASE_SQUASH; // flattened a little where he sits
    pos.setXYZ(i, v.x * r * widen, y, v.z * r * widen);
  }
  geo.computeVertexNormals();

  // The sphere's UV seam duplicates vertices; average their normals so no seam shows.
  const normals = geo.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const n = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.add(v.fromBufferAttribute(normals, i));
    n.normalize();
    for (const i of list) normals.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

export class BlobBody implements Body {
  readonly object = new THREE.Group();
  readonly halfExtents: [number, number];
  readonly anchors: Record<Slot, THREE.Object3D>;

  private readonly pose = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly armMaterial: THREE.MeshPhysicalMaterial;
  private readonly armColor: THREE.Color;
  private readonly textures = new FaceTextures();
  private readonly euler = new THREE.Euler();
  private readonly meshes: THREE.Mesh[] = [];

  private time = 0;
  private phase = 0;
  private spin = 0;
  private rock = 0; // forward/back lean while he "rolls" on the spot (he can't roll)
  private rockPhase = 0;

  constructor(
    skin: Skin,
    private readonly ppu: number,
  ) {
    const [sx, sy] = skin.shape;
    this.halfExtents = [sx * 1.08, sy / BALL_FILL];
    // Sit the flat base on the bottom of the hit box.
    this.object.position.y = -(1 / BALL_FILL + BOTTOM_Y) * sy;

    // Plush, slightly fuzzy look like the reference.
    this.material = new THREE.MeshPhysicalMaterial({
      roughness: skin.roughness,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0xfff2a0),
    });

    const shaped = new THREE.Group();
    shaped.scale.set(sx, sy, (sx + sy) / 2);
    const body = new THREE.Mesh(blobGeometry(), this.material);
    shaped.add(body);
    this.meshes.push(body);

    // Tiny arms resting on the roll, pivoting at the shoulder.
    const armGeo = new THREE.SphereGeometry(1, 24, 16);
    this.armColor = new THREE.Color(skin.color);
    const armMat = (this.armMaterial = new THREE.MeshPhysicalMaterial({
      color: skin.color,
      roughness: skin.roughness,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0xfff2a0),
    }));
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      // Shoulder just outside the body, so the stub shows instead of sinking in.
      arm.position.set(side * 1.0, -0.02, 0.28);
      const mesh = new THREE.Mesh(armGeo, armMat);
      mesh.scale.set(0.13, 0.25, 0.15);
      mesh.position.set(side * 0.03, -0.17, 0.04);
      arm.add(mesh);
      this.meshes.push(mesh);
      this.arms.push(arm);
      shaped.add(arm);
    }

    // He doesn't roll, so everything he wears sits on the shaped body. His dot
    // eyes are smaller and higher than Verity's, so face items shrink and move up.
    const face = new THREE.Group();
    face.position.set(0, 0.34, 0.2);
    face.scale.setScalar(0.72);
    const neck = new THREE.Group(); // in the chin roll, under his mouth
    neck.position.set(0, 0.1, 1.0);
    neck.scale.setScalar(0.7);
    neck.rotation.x = -0.15;
    shaped.add(face, neck);
    this.anchors = { head: shaped, face, neck };
    this.pose.add(shaped);
    this.object.add(this.pose);
  }

  setLook(l: Look): void {
    this.material.map = this.textures.get(l);
    this.material.needsUpdate = true;
  }

  impact(): void {}

  setTint(color: THREE.Color | null): void {
    this.material.color.set(color ?? 0xffffff);
    this.armMaterial.color.copy(this.armColor);
    if (color) this.armMaterial.color.multiply(color);
  }

  update(dt: number, m: Motion, look: THREE.Quaternion): void {
    this.time += dt;
    const t = this.time;
    const moving = m.state === "walk" || m.state === "exercise";
    const falling = m.state === "fall";

    if (moving) this.phase += Math.abs(m.dx) / STEP_PX;
    const sway = moving ? Math.sin(this.phase) * 0.13 : 0;

    // Thrown hard sideways: spin. Otherwise wobble back upright.
    if (falling && Math.abs(m.vx) > TUMBLE_SPEED) {
      this.spin -= m.dx / (this.ppu * this.halfExtents[0]);
    } else {
      const upright = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin += (upright - this.spin) * (1 - Math.exp(-dt * (falling ? 3 : 7)));
    }

    // Face the cursor a little when not busy.
    this.euler.setFromQuaternion(look);
    const attentive = !moving && !falling ? 0.35 : 0;
    // Asked to roll on the spot: he rocks towards you and back instead, leaning the way he's going.
    if (m.spin) {
      this.rockPhase += Math.abs(m.spin) / STEP_PX;
      this.rock = Math.sign(m.spin) * (0.15 + 0.2 * Math.abs(Math.sin(this.rockPhase)));
    } else {
      this.rock *= Math.exp(-dt * 6);
    }
    this.pose.rotation.set(this.euler.x * attentive + this.rock, this.euler.y * attentive, this.spin + sway);

    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      let out = 0.2 + (moving ? 0.35 * Math.abs(Math.sin(this.phase * 2)) : 0.05 * Math.sin(t * 2.4));
      if (falling) out = 1.3 + Math.sin(t * 22 + i * 2) * 0.5; // flail
      if (m.state === "drag") out = 2.3 + Math.sin(t * 8 + i) * 0.25; // arms up
      arm.rotation.z = side * out;
    });
  }

  dispose(): void {
    this.textures.dispose();
    const done = new Set<unknown>();
    for (const mesh of this.meshes) {
      for (const res of [mesh.geometry, mesh.material as THREE.Material]) {
        if (done.has(res)) continue;
        done.add(res);
        res.dispose();
      }
    }
  }
}

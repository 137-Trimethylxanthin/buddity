import * as THREE from "three";
import type { AccessoryId } from "./wardrobe";

// The accessory models, built from simple shapes like the rest of him.
// Coordinates are the unit ball's: the top of his head is (0, 1, 0) and his
// face looks down +z. Face items are made for the ball's face (eyes at x ±0.2,
// y 0.16); bodies with a different face scale and move the face anchor to fit.

const CREAM = 0xf3efe2;
const GOLD = 0xf2c200;

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...opts });
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

/** The white fedora with the gold band, tipped like Master Verity wears it. */
function masterHat(): THREE.Group {
  const g = new THREE.Group();
  const cream = mat(CREAM, { side: THREE.DoubleSide });
  // Wide brim, curling up a little at the edge.
  const brim = [
    [1.15, 0.07],
    [1.08, 0.025],
    [0.85, 0.004],
    [0.56, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(mesh(new THREE.LatheGeometry(brim, 64), cream));
  // Tall crown, narrowing towards the top...
  const crown = [
    [0.57, 0],
    [0.555, 0.35],
    [0.5, 0.58],
    [0.38, 0.66],
    [0.18, 0.67],
    [0, 0.66],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(crown, 64);
  // ...pinched at the sides towards the top, with a crease down the middle front to back.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const up = y / 0.67;
    pos.setX(i, x * (1 - 0.2 * up * up));
    pos.setY(i, y - 0.11 * up ** 3 * Math.exp(-((x / 0.2) ** 2)));
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, cream));
  g.add(mesh(new THREE.CylinderGeometry(0.562, 0.572, 0.12, 64, 1, true), mat(GOLD, { roughness: 0.4 }), 0, 0.08, 0));
  g.position.y = 0.8;
  // Tipped forward and to one side; the brim dips at the front.
  g.rotation.set(0.22, 0, -0.14);
  return g;
}

function bow(): THREE.Group {
  const g = new THREE.Group();
  const pink = mat(0xff4f8b, { roughness: 0.45 });
  const loop = new THREE.SphereGeometry(1, 24, 16);
  for (const side of [-1, 1]) {
    const l = mesh(loop, pink, side * 0.2, 0, 0);
    l.scale.set(0.22, 0.15, 0.08);
    l.rotation.z = side * 0.35;
    g.add(l);
    const tail = mesh(loop, pink, side * 0.08, -0.17, 0);
    tail.scale.set(0.05, 0.14, 0.04);
    tail.rotation.z = side * 0.4;
    g.add(tail);
  }
  const knot = mesh(new THREE.SphereGeometry(0.075, 16, 12), pink);
  knot.scale.z = 0.8;
  g.add(knot);
  // On the top of his head, a little to one side, lying along the curve.
  g.position.set(-0.42, 0.88, 0.22);
  g.rotation.set(-0.35, 0, 0.45);
  g.scale.setScalar(1.45);
  return g;
}

function crown(): THREE.Group {
  const g = new THREE.Group();
  const gold = mat(GOLD, { metalness: 0.7, roughness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.43, 0.2, 48, 1, true), mat(GOLD, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide })));
  const spike = new THREE.ConeGeometry(0.075, 0.22, 12);
  const gem = new THREE.SphereGeometry(0.045, 12, 8);
  const gems = [mat(0xe0203a, { roughness: 0.2 }), mat(0x2a6bff, { roughness: 0.2 })];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = Math.sin(a) * 0.4;
    const z = Math.cos(a) * 0.4;
    g.add(mesh(spike, gold, x, 0.2, z));
    g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), gold, x, 0.32, z));
    g.add(mesh(gem, gems[i % 2], Math.sin(a) * 0.425, 0, Math.cos(a) * 0.425));
  }
  g.position.y = 0.9;
  g.rotation.set(0.05, 0, 0.12);
  return g;
}

function partyHat(): THREE.Group {
  const g = new THREE.Group();
  // Stripes painted around the cone.
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const x = c.getContext("2d")!;
  const colours = ["#38c6ff", "#ff4f8b", "#ffd21f", "#7ae05a"];
  for (let i = 0; i < 8; i++) {
    x.fillStyle = colours[i % colours.length];
    x.fillRect(i * 16, 0, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cone = mesh(new THREE.ConeGeometry(0.3, 0.7, 40, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
  cone.position.y = 0.35;
  g.add(cone);
  g.add(mesh(new THREE.SphereGeometry(0.09, 16, 12), mat(0xffffff, { roughness: 0.9 }), 0, 0.72, 0));
  g.position.set(0.18, 0.86, 0);
  g.rotation.z = -0.3;
  return g;
}

function horns(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xc4141c, { roughness: 0.35 });
  for (const side of [-1, 1]) {
    // Two cones per horn, the tip bent outwards.
    const horn = new THREE.Group();
    horn.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.18, 16), red, 0, 0.09, 0));
    const tip = mesh(new THREE.ConeGeometry(0.06, 0.2, 16), red, 0.02 * side, 0.26, 0);
    tip.rotation.z = -side * 0.4;
    horn.add(tip);
    horn.position.set(side * 0.42, 0.86, 0.15);
    horn.rotation.set(-0.15, 0, -side * 0.45);
    horn.scale.setScalar(1.3);
    g.add(horn);
  }
  return g;
}

function halo(): THREE.Group {
  const g = new THREE.Group();
  const ring = mesh(
    new THREE.TorusGeometry(0.42, 0.045, 12, 48),
    mat(0xffe25a, { emissive: 0xffc800, emissiveIntensity: 0.8, roughness: 0.3 }),
  );
  ring.rotation.x = Math.PI / 2 - 0.25;
  g.add(ring);
  g.position.y = 1.3;
  return g;
}

/** Round black sunglasses over his eyes (which sit at x ±0.2, y 0.16 on the ball). */
function shades(): THREE.Group {
  const g = new THREE.Group();
  const lensMat = mat(0x0b0b10, { roughness: 0.08, metalness: 0.4 });
  const frame = mat(0x111111, { roughness: 0.4 });
  const lens = new THREE.CylinderGeometry(0.165, 0.165, 0.03, 32);
  for (const side of [-1, 1]) {
    const l = mesh(lens, lensMat, side * 0.2, 0.17, 1.01);
    l.rotation.set(Math.PI / 2 - 0.17, side * 0.2, 0);
    g.add(l);
    // Arm along the side of his head.
    const arm = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.45), frame, side * 0.37, 0.19, 0.84);
    arm.rotation.y = side * 0.5;
    g.add(arm);
  }
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), frame, 0, 0.21, 1.02));
  return g;
}

function bowtie(): THREE.Group {
  const g = new THREE.Group();
  const black = mat(0x15151a, { roughness: 0.5 });
  const wing = new THREE.ConeGeometry(0.12, 0.2, 3);
  for (const side of [-1, 1]) {
    const w = mesh(wing, black, side * 0.1, 0, 0);
    w.rotation.z = side * (Math.PI / 2);
    w.scale.z = 0.4;
    g.add(w);
  }
  g.add(mesh(new THREE.SphereGeometry(0.05, 12, 8), black));
  g.scale.setScalar(1.7);
  return g; // the body's neck anchor places it
}

const BUILD: Record<AccessoryId, () => THREE.Group> = {
  master: masterHat,
  bow,
  crown,
  party: partyHat,
  horns,
  halo,
  shades,
  bowtie,
};

/**
 * A handheld microphone (mic mode), its grip at the origin and its head up +y.
 * The body's hand anchor holds it and tips it towards his mouth.
 */
export function buildMic(): THREE.Group {
  const g = new THREE.Group();
  const black = mat(0x26262b, { roughness: 0.45 });
  const steel = mat(0xb9bec7, { metalness: 0.8, roughness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.55, 20), black, 0, 0.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.09, 20), steel, 0, 0.4, 0));
  // The grille: a ball with a wire mesh over it.
  g.add(mesh(new THREE.SphereGeometry(0.15, 24, 16), mat(0x8b9099, { metalness: 0.7, roughness: 0.55 }), 0, 0.54, 0));
  g.add(mesh(new THREE.SphereGeometry(0.152, 18, 8), mat(0x595e66, { metalness: 0.6, roughness: 0.4, wireframe: true }), 0, 0.54, 0));
  return g;
}

/** A fresh model of the accessory. */
export function buildAccessory(id: AccessoryId): THREE.Group {
  return BUILD[id]();
}

/** Frees an accessory model's geometry, materials and textures. */
export function disposeAccessory(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat() as THREE.MeshStandardMaterial[]) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

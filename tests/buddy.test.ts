// Physics around other apps' windows (bun test). Found on Windows, where maximising,
// snapping and restoring make windows jump in one update.
import { beforeEach, expect, test } from "bun:test";

Object.assign(globalThis, { innerWidth: 1280, innerHeight: 752 });
const { Buddy } = await import("../src/buddy");

const SIZE = 160;
const FLOOR = 752 - SIZE;
let buddy: InstanceType<typeof Buddy>;

beforeEach(() => {
  buddy = new Buddy(SIZE, SIZE, () => {}, () => {});
});

/** Put him somewhere and keep him from strolling or hopping off on his own (that's random). */
function place(x: number): void {
  buddy.teleport(x);
  buddy.hold(0, 1e6);
}

/** Run the simulation for `ms` at 60 fps, starting at `t`; returns the fastest speed seen. */
function run(t: number, ms: number): number {
  let fastest = 0;
  for (let now = t; now < t + ms; now += 1000 / 60) {
    buddy.step(1 / 60, now);
    fastest = Math.max(fastest, Math.hypot(buddy.vx, buddy.vy));
  }
  return fastest;
}

test("a window jumping into him knocks him no faster than a throw", () => {
  place(400);
  // A maximise reported as one 900 px jump between two polls 16 ms apart.
  buddy.knock(-900 / 0.016, 0, { id: "w", x: 0, y: 0, w: 1280, h: 754 });
  expect(Math.hypot(buddy.vx, buddy.vy)).toBeLessThanOrEqual(2800);
  expect(run(0, 3000)).toBeLessThanOrEqual(2800);
});

test("a wall that jumps into him pushes him no faster than a throw", () => {
  const win = { id: "w", x: 200, y: 300, w: 700, h: 400 };
  place(500); // x = 420
  buddy.y = win.y + win.h - SIZE;
  buddy.moveBox(win, "in", 0);
  // Snapped to the left half in one update: the right wall lands well left of him.
  buddy.moveBox({ ...win, x: 0, w: 400 }, "in", 16);
  expect(run(16, 3000)).toBeLessThanOrEqual(2800);
});

test("loose in a window that reaches past the taskbar, he comes to rest on the floor", () => {
  const win = { id: "w", x: 0, y: 0, w: 1280, h: 754 }; // a maximised window's frame, 2 px past the work area
  place(500);
  buddy.y = 300;
  buddy.moveBox(win, "in", 0);
  run(0, 4000);
  expect(buddy.container).toBeNull();
  expect(buddy.y).toBe(FLOOR);
});

test("the floor doesn't bounce him with the speed of a window bottom that's under the taskbar", () => {
  const win = { id: "w", x: 200, y: 400, w: 700, h: 600 }; // bottom 248 px below the floor
  place(500);
  buddy.y = FLOOR;
  buddy.moveBox(win, "in", 0);
  for (let i = 1; i <= 10; i++) {
    buddy.moveBox({ ...win, y: win.y - i * 10 }, "in", i * 16); // dragged up at 625 px/s
    buddy.step(0.016, i * 16);
    expect(buddy.vy).toBeGreaterThanOrEqual(0); // nothing under him moved up
  }
});

test("a window dragged fast pushes him along with its wall", () => {
  const win = { id: "w", x: 420, y: 300, w: 700, h: 400 }; // left wall touching him
  place(500);
  buddy.y = win.y + win.h - SIZE;
  buddy.moveBox(win, "in", 0);
  for (let i = 1; i <= 30; i++) {
    const x = win.x + i * 32; // 2000 px/s to the right
    buddy.moveBox({ ...win, x }, "in", i * 16);
    buddy.step(0.016, i * 16);
    expect(buddy.x).toBeGreaterThanOrEqual(x);
  }
  expect(buddy.vx).toBeGreaterThan(1500);
});

test("left below the floor (the screen got shorter under him), he's put back on it", () => {
  place(500);
  buddy.y = FLOOR + 256; // moved to a screen with a different scale, placed for the old one
  run(0, 100);
  expect(buddy.y).toBe(FLOOR);
});

// ---------- Chained up ----------

const dist = (t: { x: number; y: number }) => Math.hypot(buddy.x + SIZE / 2 - t.x, buddy.y + SIZE / 2 - t.y);

test("chained, a hard throw away from the anchor stops at the chain's length and swings", () => {
  place(500);
  const t = { x: 580, y: 752 - 18, len: 300 };
  buddy.tether = t;
  buddy.vx = 2500;
  buddy.vy = -1200;
  (buddy as unknown as { set(s: string): void }).set("fall");
  let furthest = 0;
  for (let now = 0; now < 4000; now += 1000 / 60) {
    buddy.step(1 / 60, now);
    furthest = Math.max(furthest, dist(t));
  }
  expect(furthest).toBeLessThanOrEqual(t.len + 0.01);
});

test("with the anchor up high he dangles from it, coming to hang still under it", () => {
  place(500);
  const t = { x: 300, y: 100, len: 250 };
  buddy.tether = t;
  run(0, 15_000);
  expect(buddy.state).toBe("fall"); // off the floor
  expect(dist(t)).toBeCloseTo(t.len, 0);
  expect(Math.abs(buddy.x + SIZE / 2 - t.x)).toBeLessThan(10); // straight under it
  expect(Math.hypot(buddy.vx, buddy.vy)).toBeLessThan(5);
});

test("walking off, he stops at the end of his chain", () => {
  place(500);
  const t = { x: 580, y: 752 - 18, len: 200 };
  buddy.tether = t;
  buddy.hold(0, 0);
  buddy.seek(1200, () => {});
  run(0, 10_000);
  expect(dist(t)).toBeLessThanOrEqual(t.len + 0.01);
  expect(buddy.canReach(1200)).toBe(false);
  expect(buddy.canReach(600)).toBe(true);
});

test("dragged, he can't be pulled past his chain", () => {
  place(500);
  const t = { x: 580, y: 400, len: 200 };
  buddy.tether = t;
  buddy.startDrag(580, 600, 0);
  buddy.dragTo(1200, 300, 16);
  expect(dist(t)).toBeLessThanOrEqual(t.len + 0.01);
});

test("unchained, nothing holds him back", () => {
  place(500);
  buddy.tether = null;
  buddy.startDrag(580, 600, 0);
  buddy.dragTo(1100, 300, 16);
  expect(buddy.x).toBe(1100 - (580 - 420)); // where the cursor took him (it grabbed him 160 px in)
});

test("hanging still from his chain counts as dangling; flying past doesn't", () => {
  place(500);
  const t = { x: 300, y: 100, len: 250 };
  buddy.tether = t;
  run(0, 15_000);
  expect(buddy.dangling).toBe(true);
  buddy.tether = null;
  expect(buddy.dangling).toBe(false);
});

test("sent somewhere past the end of his chain, he doesn't get there, and whoever sent him hears so", () => {
  place(500);
  buddy.tether = { x: 580, y: 752 - 18, len: 200 };
  buddy.hold(0, 0);
  let arrived = false;
  let abandoned = false;
  buddy.seek(1200, () => (arrived = true), () => (abandoned = true));
  run(0, 10_000);
  expect(arrived).toBe(false);
  expect(abandoned).toBe(true);
});

test("lifted off the floor on his way somewhere (the anchor went up), the errand is off", () => {
  place(500);
  const t = { x: 580, y: 752 - 18, len: 240 };
  buddy.tether = t;
  buddy.hold(0, 0);
  let arrived = false;
  buddy.seek(900, () => (arrived = true));
  buddy.step(1 / 60, 0);
  t.y = 100; // dragged up high
  run(16, 5000);
  expect(arrived).toBe(false);
  expect(buddy.state).not.toBe("exercise");
});

test("chained, a teleport only goes as far as the chain", () => {
  place(500);
  buddy.tether = { x: 580, y: 752 - 18, len: 200 };
  buddy.teleport(1200);
  expect(dist(buddy.tether)).toBeLessThanOrEqual(200 + 0.01);
});

test("pulled sideways off a window top by his chain, he falls instead of floating", () => {
  place(500);
  const ledge = { id: "w:top", x1: 300, x2: 700, y: 400, anchor: 300 };
  buddy.setPlatforms([ledge], false);
  buddy.x = 420;
  buddy.y = ledge.y - SIZE;
  buddy.standingOn = ledge;
  const t = { x: 500, y: 734, len: 450 };
  buddy.tether = t;
  for (let i = 0; i < 60 && buddy.state !== "fall"; i++) {
    t.x -= 10; // the anchor dragged away to the left along the floor
    buddy.step(1 / 60, i * 16);
  }
  expect(buddy.state).toBe("fall");
  expect(buddy.standingOn).toBeNull();
});

test("a taut chain to the floor never pushes him into it", () => {
  place(500);
  const t = { x: 580, y: 752 - 18, len: 240 };
  buddy.tether = t;
  for (let i = 0; i < 60; i++) {
    t.x += 15; // dragged away along the floor
    buddy.step(1 / 60, i * 16);
    expect(buddy.y).toBeLessThanOrEqual(FLOOR + 0.01);
  }
});

test("a NaN anchor leaves him alone", () => {
  place(500);
  buddy.tether = { x: NaN, y: 100, len: 200 };
  run(0, 200);
  expect(Number.isFinite(buddy.x) && Number.isFinite(buddy.y)).toBe(true);
});

test("stopped on his way, whoever sent him hears he isn't going", () => {
  place(500);
  buddy.tether = null;
  buddy.hold(0, 0);
  let abandoned = false;
  buddy.seek(1000, () => {}, () => (abandoned = true));
  buddy.step(1 / 60, 0);
  buddy.stop(16);
  expect(abandoned).toBe(true);
});

test("chained to the floor, a high ledge is out of reach even straight above the anchor", () => {
  place(500);
  buddy.tether = { x: 580, y: 752 - 18, len: 240 };
  expect(buddy.canReach(580)).toBe(true);
  expect(buddy.canReach(580, 200 - SIZE)).toBe(false); // a ledge at y = 200
  expect(buddy.canReach(580, 620 - SIZE)).toBe(true); // a low one (his middle 194 px above the anchor)
});

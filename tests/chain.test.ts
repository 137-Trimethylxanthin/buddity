// The chain's state: limits, bolting to windows, saving (bun test, with a tiny DOM stand-in).
import { expect, test } from "bun:test";

// Just enough DOM for Chain's elements.
class El {
  classList = { add() {}, toggle() {} };
  style: Record<string, string> = {};
  innerHTML = "";
  title = "";
  className = "";
  append() {}
  setAttribute() {}
}
Object.assign(globalThis, {
  innerWidth: 1280,
  innerHeight: 752,
  document: { createElement: () => new El(), createElementNS: () => new El() },
});
const { Chain, CHAIN_MAX, CHAIN_MIN } = await import("../src/chain");

const win = { id: "w", app: "Notepad", x: 400, y: 200, w: 600, h: 300, menu: false };

test("chain length stays within limits", () => {
  const c = new Chain(new El() as unknown as HTMLElement);
  c.attach(100, 100, 10);
  expect(c.state!.len).toBe(CHAIN_MIN);
  c.lengthen(10_000);
  expect(c.state!.len).toBe(CHAIN_MAX);
});

test("an anchor dropped on a window moves with it, and stays put when the window goes", () => {
  const c = new Chain(new El() as unknown as HTMLElement);
  c.attach(500, 250, 300);
  c.boltTo([win]);
  expect(c.state!.win).toEqual({ id: "w", dx: 100, dy: 50 });
  c.follow([{ ...win, x: 600, y: 300 }]);
  expect([c.state!.x, c.state!.y]).toEqual([700, 350]);
  c.follow([]);
  expect([c.state!.x, c.state!.y]).toEqual([700, 350]);
});

test("menus aren't something to bolt to", () => {
  const c = new Chain(new El() as unknown as HTMLElement);
  c.attach(500, 250, 300);
  c.boltTo([{ ...win, menu: true }]);
  expect(c.state!.win).toBeNull();
});

test("saved and restored; junk leaves him free", () => {
  const c = new Chain(new El() as unknown as HTMLElement);
  c.attach(500, 250, 300);
  c.boltTo([win]);
  const back = new Chain(new El() as unknown as HTMLElement);
  back.restore(c.serialize());
  expect(back.state).toEqual(c.state);
  for (const junk of [null, "", "{", "null", '{"x":"a","y":1,"len":2}', "[1,2]"]) {
    const j = new Chain(new El() as unknown as HTMLElement);
    j.restore(junk);
    expect(j.on).toBe(false);
  }
});

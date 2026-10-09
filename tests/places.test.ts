// Windows in the character window's coordinates (bun test).
import { expect, test } from "bun:test";
import { toBoxes } from "../src/places";

const screen = { x: 0, y: 0, w: 1920, h: 1080, scale: 1, current: true, primary: true, mirror: false, floor: 1080 };

test("a taskbar on the left moves the window, so windows line up with where it starts", () => {
  const here = { ...screen, left: 62, width: 1858 }; // a 62 px taskbar or dock down the left side
  const [box] = toBoxes([{ id: "w", app: "Notepad", x: 400, y: 300, w: 600, h: 400 }], [here], here, 1080);
  expect(box.x).toBe(400 - 62);
});

test("scaled screens convert from where the window starts", () => {
  const here = { ...screen, w: 2880, h: 1800, scale: 1.5, left: 72, width: 2808, floor: 1728 };
  const [box] = toBoxes([{ id: "w", app: "Notepad", x: 372, y: 228, w: 900, h: 600 }], [here], here, 1152);
  expect(box).toMatchObject({ x: 200, y: 1152 - 1500 / 1.5, w: 600, h: 400 });
});

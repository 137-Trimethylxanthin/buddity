import { Buddy, type Side, type State } from "./buddy";
import { Face, type Mouth } from "./face";
import { dizzyLines, greet, moodForHour, ouchLines, pick, quiz, randomLine, type Context, type Mood } from "./lines";
import { ContextMenu, type MenuItem } from "./menu";
import { getUsername, inTauri, nudgeCursor, onCursor, onTray, scrollActive, setHitRegions, type Rect } from "./native";
import { emit } from "./particles";
import { Prop, spawnFood, spawnPuke, Treadmill } from "./props";
import { isSkinId, SKIN_IDS, SKINS, type Skin } from "./skins";
import { BEAT_S, snippets, vowelOf } from "./song";
import { Speech } from "./speech";
import { autostartEnabled, findUpdate, installUpdate, setAutostart } from "./updates";
import { Voice } from "./voice";

const SIZE = 160;
const DRAG_THRESHOLD = 4;
const QUIZ_CHANCE = 0.2;
const SING_CHANCE = 0.3; // of idle chatter
const BUBBLE_GAP = 18;
const OUCH_SPEED = 1300; // px/s impact that makes him wince
const DIZZY_ENERGY = 6500; // summed impact speed within DIZZY_WINDOW_MS
const DIZZY_WINDOW_MS = 2500;
const PESTER_AFTER_MS = 5 * 60_000; // ignored this long, he comes to get your attention
const CURSOR_FRESH_MS = 5000; // how recent a known cursor position must be to roll over to it
const UPDATE_FIRST_CHECK_MS = 20_000;
const UPDATE_EVERY_MS = 6 * 60 * 60_000;
const MENU_DELAY_MS = 220; // a right-click waits this long in case the left button joins (squeeze)
const SQUEEZE_FULL_MS = 1100; // time to squeeze all the way
const EDGE_SQUISH_PX = 110; // pushing this far into an edge squishes him fully
const SHAKE_SPEED = 700; // px/s drag speed that counts as a shake stroke
const SHAKE_STROKES = 5; // direction changes within SHAKE_WINDOW_MS
const SHAKE_WINDOW_MS = 1400;
const FOOD_TO_OBESITY = 3;
const TREADMILL_SPEED = 230; // px/s the belt "moves" (drives his rolling)
const WORKOUT_MS = 9000;

const stageEl = document.getElementById("stage")!;
const vignetteEl = document.getElementById("vignette")!;
const buddyEl = document.getElementById("buddy")!;
const faceEl = document.getElementById("verity")!;
const bubbleEl = document.getElementById("bubble")!;

// Per-viewer preferences; storage can be unavailable, so every access is guarded.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted */
  }
}

const savedSkin = load("skin") ?? "verity";
let skin: Skin = SKINS[isSkinId(savedSkin) ? savedSkin : "verity"];
let mood: Mood = moodForHour(new Date());
let cursor: { x: number; y: number } | null = null;
let cursorAt = 0;
let singing = false;

const ctx: Context = { user: "friend", now: new Date(), skin };
const voice = new Voice();
voice.muted = load("muted") === "1";
const face = new Face(faceEl, SIZE, skin);
const buddy = new Buddy(SIZE * skin.shape[0], SIZE * skin.shape[1], onStateChange, onImpact);
const speech = new Speech(bubbleEl, {
  onTalking: (on) => {
    if (!on && !singing) face.setMouth("smile");
  },
  onLayout: () => (regionsDirty = true),
  onChar: (ch) => {
    if (/[a-z]/i.test(ch)) {
      voice.blip(ch);
      face.setMouth(/[aeiouy]/i.test(ch) ? (Math.random() < 0.6 ? "open" : "o") : "smile");
    } else {
      face.setMouth("smile");
    }
  },
});
const menu = new ContextMenu(document.getElementById("menu")!, () => (regionsDirty = true));

function onStateChange(state: State): void {
  faceEl.classList.remove("idle", "walk", "fall", "drag", "exercise");
  faceEl.classList.add(state);
}

// ---------- Skins and mood ----------

function applySkin(next: Skin): void {
  skin = next;
  ctx.skin = next;
  face.setSkin(next);
  buddy.resize(SIZE * next.shape[0], SIZE * next.shape[1]);
  buddy.physics = { walkSpeed: next.walkSpeed, bounce: next.bounce };
  buddyEl.style.width = `${buddy.w}px`;
  buddyEl.style.height = `${buddy.h}px`;
  voice.pitch = next.voicePitch;
  save("skin", next.id);
  regionsDirty = true;
}

/** Switch skin with a puff: growing into Obesity or slimming back down. */
function morphInto(next: Skin): void {
  const grow = next.shape[0] * next.shape[1] > skin.shape[0] * skin.shape[1];
  applySkin(next);
  playClass(faceEl, grow ? "morph-grow" : "morph-shrink", 900);
  voice.morph(grow);
  face.impact("floor", 2200);
  const { x, y } = centre();
  for (let i = 0; i < 10; i++) emit(stageEl, x + (Math.random() - 0.5) * buddy.w, y + buddy.h / 2, "💨", "#fff");
}

function setMood(next: Mood): void {
  const wasCreepy = mood === "creepy";
  mood = next;
  face.setMood(mood);
  voice.creepy = mood === "creepy";
  vignetteEl.classList.toggle("on", mood === "creepy");
  if (mood === "creepy") {
    face.twitch();
    if (!wasCreepy) {
      voice.static(0.5);
      window.setTimeout(() => voice.laugh(), 600);
      scheduleCreepyAntics();
    }
  }
}

// ---------- Evil mode antics: glitching and teleporting next to your cursor ----------

let creepyTimer = 0;

function scheduleCreepyAntics(): void {
  window.clearTimeout(creepyTimer);
  creepyTimer = window.setTimeout(() => {
    if (mood !== "creepy") return;
    if (Math.random() < 0.3 && buddy.grounded && !buddy.busy && !singing) teleportNearCursor();
    else {
      playClass(faceEl, "glitch", 400);
      if (Math.random() < 0.5) voice.static(0.15);
    }
    scheduleCreepyAntics();
  }, 4000 + Math.random() * 6000);
}

function teleportNearCursor(): void {
  playClass(faceEl, "vanish", 350);
  voice.static(0.4);
  window.setTimeout(() => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const target = cursor ? cursor.x + side * (120 + Math.random() * 120) : Math.random() * innerWidth;
    buddy.teleport(target);
    playClass(faceEl, "appear", 400);
    if (Math.random() < 0.5) window.setTimeout(() => say(randomLine("creepy", ctx)), 300);
    else window.setTimeout(() => voice.laugh(), 200);
  }, 360);
}

// In creepy mode he wanders towards wherever your cursor is.
buddy.chooseTarget = () =>
  mood === "creepy" && cursor && Math.random() < 0.7 ? cursor.x - buddy.w / 2 : null;

function playClass(el: HTMLElement, cls: string, ms: number): void {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

// ---------- Talking and singing ----------

function say(line: string, choices?: string[], onChoice?: (c: string) => void): void {
  if (singing) return;
  buddy.hold(performance.now(), 6000);
  speech.say(line, mood, choices, onChoice);
}

function talk(): void {
  ctx.now = new Date();
  if (Math.random() < QUIZ_CHANCE) {
    const q = quiz(ctx);
    say(q.question, q.choices, (choice) => {
      say(q.reply(choice));
      giggle();
    });
  } else {
    say(randomLine(mood, ctx));
  }
}

function giggle(): void {
  face.giggle();
  voice.giggle();
}

function centre(): { x: number; y: number } {
  return { x: buddy.x + buddy.w / 2, y: buddy.y };
}

/** Sings a short snippet: lyrics in the bubble, sung notes, hops on the beat, floating notes. */
function sing(): void {
  if (singing || buddy.busy) return;
  const options = snippets(skin);
  const notes = options[Math.floor(Math.random() * options.length)];
  singing = true;
  buddy.hold(performance.now(), 60_000);

  let lyric = "♪";
  let t = 0;
  notes.forEach((note, i) => {
    const dur = note.beats * BEAT_S;
    window.setTimeout(() => {
      lyric += (note.join ? "" : " ") + note.syl;
      speech.show(`${lyric} ♪`, mood);
      voice.note(note.semis, dur * 0.95, vowelOf(note.syl));
      const vowel = vowelOf(note.syl);
      const mouth: Mouth = note.beats >= 2 || vowel === "o" || vowel === "u" ? "o" : "open";
      face.setMouth(mouth);
      window.setTimeout(() => face.setMouth("smile"), dur * 900);
      if (i % 2 === 0) buddy.hop(0.45);
      const { x, y } = centre();
      emit(stageEl, x + (Math.random() - 0.5) * buddy.w, y, pickGlyph(), skin.particleColor);
    }, t * 1000);
    t += dur;
  });
  window.setTimeout(() => {
    singing = false;
    face.setMouth("smile");
    speech.hideLater(1500);
    buddy.hold(performance.now(), 2000);
  }, t * 1000 + 150);
}

function pickGlyph(): string {
  return skin.particles[Math.floor(Math.random() * skin.particles.length)];
}

// ---------- Hits ----------

const recentHits: { t: number; speed: number }[] = [];

function onImpact(side: Side, speed: number): void {
  face.impact(side, speed);
  const now = performance.now();
  recentHits.push({ t: now, speed });
  while (recentHits.length && now - recentHits[0].t > DIZZY_WINDOW_MS) recentHits.shift();
  const energy = recentHits.reduce((sum, h) => sum + h.speed, 0);

  if (energy > DIZZY_ENERGY) {
    recentHits.length = 0;
    face.flashEyes("dizzy", 2200);
    voice.oof();
    window.setTimeout(() => say(pick(dizzyLines, ctx)), 400);
  } else if (speed > OUCH_SPEED) {
    face.flashEyes("squeeze", 380);
    voice.oof();
    if (Math.random() < 0.3) say(pick(ouchLines, ctx));
  }
}

// ---------- Shaking and puking ----------

const shakeStrokes: number[] = [];
let lastShakeDir = 0;
let sickUntil = 0;

/** Called while dragging: quick back-and-forth strokes count as shaking. */
function trackShake(now: number): void {
  const dir = Math.abs(buddy.vx) > SHAKE_SPEED ? Math.sign(buddy.vx) : 0;
  if (dir !== 0 && dir !== lastShakeDir) {
    if (lastShakeDir !== 0) shakeStrokes.push(now);
    lastShakeDir = dir;
  }
  while (shakeStrokes.length && now - shakeStrokes[0] > SHAKE_WINDOW_MS) shakeStrokes.shift();
  if (shakeStrokes.length >= SHAKE_STROKES && now > sickUntil) {
    shakeStrokes.length = 0;
    shaken(now);
  }
}

function shaken(now: number): void {
  sickUntil = now + 3500;
  face.flashEyes("dizzy", 1800);
  face.setSick(true);
  voice.oof();
  window.setTimeout(() => face.setSick(false), 3500);
  if (skin.id === "obesity") window.setTimeout(puke, 500);
  else say(pick(["Stop shaking me! @_@", "I feel sick... tee hee", "The world is wobbly!"], ctx));
}

function puke(): void {
  face.flashEyes("squeeze", 1500);
  face.setMouth("open");
  voice.bleh();
  say("Bleeeugh 🤮");
  const dir = cursor && cursor.x < buddy.x + buddy.w / 2 ? -1 : 1;
  let n = 0;
  const spray = window.setInterval(() => {
    const mouthX = buddy.x + buddy.w / 2 + dir * buddy.w * 0.1;
    const mouthY = buddy.y + buddy.h * 0.42;
    for (let i = 0; i < 3; i++) props.push(spawnPuke(stageEl, mouthX, mouthY, dir));
    if (++n >= 28) {
      window.clearInterval(spray);
      face.setMouth("smile");
    }
  }, 45);
}

// ---------- Squeezing (hold both mouse buttons on him) ----------

let squeezeStart = 0;
let squeezing = false;
let squeezeEndedAt = 0;

function startSqueeze(): void {
  squeezing = true;
  squeezeStart = performance.now();
  buddy.hold(squeezeStart, 4000);
  voice.squeak();
}

function endSqueeze(): void {
  if (!squeezing) return;
  const held = performance.now() - squeezeStart;
  squeezing = false;
  squeezeEndedAt = performance.now();
  face.setPress(null);
  if (held > 300) {
    voice.boing();
    if (Math.random() < 0.5) giggle();
  }
}

// ---------- Getting your attention when ignored ----------

let lastNoticed = performance.now();
let pesterOn = load("pester") !== "0";

/** Any interaction with him resets the "ignored" timer. */
function noticed(): void {
  lastNoticed = performance.now();
}

function maybePester(now: number): void {
  if (!pesterOn || now - lastNoticed < PESTER_AFTER_MS) return;
  if (!buddy.grounded || buddy.busy || singing || squeezing) return;
  lastNoticed = now; // and again after another round of being ignored
  say(pick(["Hey! {user}! Look at me!", "Psst... {user}...", "I'm bored. Play with me!", "Hellooo? Anyone there?"], ctx));
  // Roll over to the cursor if we know where it is (not always possible on Wayland).
  if (cursor && now - cursorAt < CURSOR_FRESH_MS) buddy.seek(cursor.x, bumpCursor);
  else window.setTimeout(bumpCursor, 1500);
}

/** Bumps the real cursor a few times, then scrolls your window down and back up. */
function bumpCursor(): void {
  const dir = cursor && cursor.x < buddy.x + buddy.w / 2 ? -1 : 1;
  [0, 220, 440, 660].forEach((ms, i) =>
    window.setTimeout(() => {
      nudgeCursor(i % 2 ? -dir * 18 : dir * 45, i % 2 ? 8 : -12);
      face.setMouth("open");
      voice.blip("a");
      window.setTimeout(() => face.setMouth("smile"), 120);
    }, ms),
  );
  window.setTimeout(() => {
    scrollActive(3);
    window.setTimeout(() => scrollActive(-3), 700);
    say("I scrolled your page. tee hee");
  }, 1600);
}

function togglePester(): void {
  pesterOn = !pesterOn;
  save("pester", pesterOn ? "1" : "0");
  say(pesterOn ? "I'll come find you if you ignore me. tee hee" : "Fine. I'll leave your cursor alone.");
}

// ---------- Starting with the PC, and updating himself ----------

let autostartOn = false;

async function initAutostart(): Promise<void> {
  // Turned on once on the first run; after that the menu switch decides.
  if (load("autostartSet") === null) {
    await setAutostart(true).catch(() => {});
    save("autostartSet", "1");
  }
  autostartOn = await autostartEnabled();
}

function toggleAutostart(): void {
  const next = !autostartOn;
  setAutostart(next)
    .then(() => {
      autostartOn = next;
      say(next ? "I'll be here when your PC starts. Always. tee hee" : "Okay, I won't start with your PC.");
    })
    .catch(() => say("Hmm, I couldn't change that."));
}

async function checkForUpdate(): Promise<void> {
  const update = await findUpdate();
  if (update) {
    say(`A new version of me is here (v${update.version})! Update now?`, ["Update", "Later"], (choice) => {
      if (choice !== "Update") return say("Okay, later! tee hee");
      say("Updating... see you in a sec! tee hee");
      installUpdate(update).catch(() => say("The update didn't work. I'll try again later."));
    });
  }
  window.setTimeout(checkForUpdate, UPDATE_EVERY_MS);
}

// ---------- Food, treadmill, getting fat and fit ----------

const props: Prop[] = [];
let treadmill: Treadmill | null = null;
let workoutUntil = 0;
let lastSweat = 0;
let foodEaten = 0;

function dropFood(): void {
  props.push(spawnFood(stageEl));
}

function placeTreadmill(): void {
  treadmill?.remove();
  const mid = buddy.x + buddy.w / 2;
  const x = mid > innerWidth / 2 ? mid - 320 : mid + 320;
  treadmill = new Treadmill(stageEl, x);
}

function foods(): Prop[] {
  return props.filter((p) => p.el.classList.contains("food") && p.landed && !p.gone);
}

/** Sends him to eat food or use the treadmill when he's free. */
function runErrands(now: number): void {
  if (!buddy.grounded || buddy.busy || singing || squeezing || now < sickUntil) return;
  const mid = buddy.x + buddy.w / 2;
  const snack = foods().sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid))[0];
  if (snack) {
    buddy.seek(snack.x, () => eat(snack));
  } else if (treadmill && !treadmill.used) {
    const tm = treadmill;
    buddy.seek(tm.x, () => startWorkout(tm));
  }
}

function eat(food: Prop): void {
  if (food.gone) return;
  buddy.hold(performance.now(), 1500);
  food.remove("eaten", 500);
  [0, 160, 320].forEach((ms, i) =>
    window.setTimeout(() => {
      face.setMouth(i % 2 ? "smile" : "open");
      if (i === 0) voice.nom();
    }, ms),
  );
  window.setTimeout(() => face.setMouth("smile"), 480);
  for (let i = 0; i < 5; i++) emit(stageEl, food.x, food.y, "•", "#b07a3c");

  if (skin.id === "verity") {
    foodEaten++;
    if (foodEaten >= FOOD_TO_OBESITY) {
      foodEaten = 0;
      window.setTimeout(() => {
        morphInto(SKINS.obesity);
        say("I feel... round. tee hee");
      }, 600);
    } else {
      say(pick(["Yummy! tee hee", "Nom nom nom!", "More please!"], ctx));
    }
  } else if (skin.id === "obesity") {
    say(pick(["Nom. Still hungry.", "Second dinner! tee hee", "Snacks are my cardio."], ctx));
  } else {
    say(pick(["Yummy! tee hee", "Thank you! 💛"], ctx));
  }
}

function startWorkout(tm: Treadmill): void {
  if (treadmill !== tm) return;
  tm.used = true;
  buddy.standOn(tm.x, tm.height);
  tm.setRunning(true);
  workoutUntil = performance.now() + (skin.id === "obesity" ? WORKOUT_MS : WORKOUT_MS / 2);
  say(skin.id === "obesity" ? "Huff... puff... for science!" : "Cardio time! ♪");
}

function updateWorkout(now: number): void {
  if (!treadmill || !treadmill.used || workoutUntil === 0) return;
  if (buddy.state !== "exercise") {
    // Pulled off mid-workout: the treadmill waits for him.
    treadmill.setRunning(false);
    treadmill.used = false;
    workoutUntil = 0;
    return;
  }
  if (now - lastSweat > 450) {
    lastSweat = now;
    const { x, y } = centre();
    emit(stageEl, x + (Math.random() - 0.5) * buddy.w * 0.8, y + 10, "💦", "#7cc8ff");
    if (Math.random() < 0.4) voice.huff();
  }
  if (now >= workoutUntil) {
    workoutUntil = 0;
    const tm = treadmill;
    tm.setRunning(false);
    buddy.stepOff();
    window.setTimeout(() => tm.remove(), 600);
    treadmill = null;
    if (skin.id === "obesity") {
      morphInto(SKINS.verity);
      window.setTimeout(() => say("I'm back to normal! tee hee"), 300);
    } else {
      say("Phew! Workout done! ♪");
    }
  }
}

// ---------- Layout and click-through ----------
// The window covers the whole screen; only the body, the bubble and the menu
// catch the mouse. While a press is in progress the whole window does, so
// dragging can't "fall off" him.

let regionsDirty = true;
let pressing = false;
let lastRegionKey = "";

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function updateRegions(): void {
  const rects = pressing
    ? [{ x: 0, y: 0, w: innerWidth, h: innerHeight }]
    : [
        rectOf(buddyEl),
        ...(speech.visible ? [rectOf(bubbleEl)] : []),
        ...(menu.visible ? [rectOf(menu.element)] : []),
      ];
  const key = rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join("|");
  if (key !== lastRegionKey) {
    lastRegionKey = key;
    setHitRegions(rects);
  }
}

function placeBubble(): void {
  const w = bubbleEl.offsetWidth;
  const h = bubbleEl.offsetHeight;
  const mid = buddy.x + buddy.w / 2;
  const left = Math.max(8, Math.min(innerWidth - w - 8, mid - w / 2));
  // Above his head, unless he's near the top of the screen.
  const above = buddy.y - h - BUBBLE_GAP;
  const top = above > 8 ? above : buddy.y + buddy.h + BUBBLE_GAP;
  bubbleEl.style.transform = `translate(${left}px, ${top}px)`;
  bubbleEl.style.setProperty("--tail", `${Math.max(20, Math.min(w - 20, mid - left))}px`);
}

// ---------- Main loop ----------

let prev = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const [x0, y0] = [buddy.x, buddy.y];
  buddy.step(dt, now);

  // Squeezing and pushing him into edges.
  if (squeezing) {
    face.setPress({ side: "squeeze", amount: Math.min(1, (now - squeezeStart) / SQUEEZE_FULL_MS) });
    face.flashEyes("squeeze", 100);
  } else if (buddy.state === "drag") {
    const p = buddy.pressure;
    face.setPress(p ? { side: p.side, amount: Math.min(1, p.depth / EDGE_SQUISH_PX) } : null);
  }

  let [vx, vy] = buddy.velocity;
  let dx = buddy.x - x0;
  if (buddy.state === "exercise") {
    dx = TREADMILL_SPEED * dt; // running on the spot
    vx = TREADMILL_SPEED;
    vy = 0;
  }
  face.update(dt, { dx, dy: buddy.y - y0, vx, vy, state: buddy.state });
  buddyEl.style.transform = `translate(${buddy.x}px, ${buddy.y}px)`;

  for (const p of props) p.step(dt);
  for (let i = props.length - 1; i >= 0; i--) if (props[i].gone) props.splice(i, 1);
  runErrands(now);
  updateWorkout(now);
  maybePester(now);

  if (speech.visible) placeBubble();
  if (regionsDirty || buddy.state !== "idle" || speech.visible) updateRegions();
  regionsDirty = false;
  requestAnimationFrame(frame);
}

// ---------- Looking at the cursor ----------
// The backend streams the global cursor; local mouse events cover browsers and
// compositors (Wayland) where the global position isn't available.

let lastLocal = 0;
onCursor((x, y) => {
  cursor = { x, y };
  cursorAt = performance.now();
  if (performance.now() - lastLocal > 300) face.lookAt(x, y);
});
window.addEventListener("mousemove", (e) => {
  lastLocal = performance.now();
  cursorAt = lastLocal;
  cursor = { x: e.clientX, y: e.clientY };
  face.lookAt(e.clientX, e.clientY);
});

// ---------- Mouse ----------
// Left click: talk. Left drag: carry, throw, shake, squish into edges.
// Both buttons held together (on him, or while carrying him): squeeze.
// Right click: menu.

let press: { x: number; y: number } | null = null;
let menuTimer = 0;
const BOTH_BUTTONS = 3;

faceEl.addEventListener("mousedown", (e) => {
  voice.unlock();
  noticed();
  if (e.button !== 0) return;
  if (menu.visible) menu.close();
  window.clearTimeout(menuTimer);
  press = { x: e.clientX, y: e.clientY };
  pressing = true;
  updateRegions();
  if ((e.buttons & BOTH_BUTTONS) === BOTH_BUTTONS) startSqueeze();
});
// While a press is going the whole window catches the mouse, so the right
// button joining in anywhere counts.
window.addEventListener("mousedown", (e) => {
  if (e.button === 2 && pressing && !squeezing) startSqueeze();
});
window.addEventListener("mousemove", (e) => {
  if (!pressing) return;
  const now = performance.now();
  if (press && !squeezing && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
    buddy.startDrag(press.x, press.y, now);
    press = null;
  }
  if (buddy.state === "drag") {
    buddy.dragTo(e.clientX, e.clientY, now);
    trackShake(now);
  }
});
window.addEventListener("mouseup", (e) => {
  // Letting go of either button ends a squeeze.
  const wasSqueezing = squeezing;
  endSqueeze();
  if (e.button !== 0 || !pressing) return;
  pressing = false;
  if (buddy.state === "drag") {
    face.setPress(null);
    buddy.release();
    if (mood === "friendly" && Math.hypot(buddy.vx, buddy.vy) > 900 && Math.random() < 0.4) say("Wheee! ☺");
  } else if (press && !wasSqueezing) {
    talk();
  }
  press = null;
  regionsDirty = true;
});
faceEl.addEventListener("dblclick", () => {
  giggle();
  say("tee hee ☺");
});
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // Part of a two-button squeeze, not a menu request.
  if (squeezing || (e.buttons & 1) || performance.now() - squeezeEndedAt < 400) return;
  if (!faceEl.contains(e.target as Node)) return;
  const { clientX, clientY } = e;
  window.clearTimeout(menuTimer);
  menuTimer = window.setTimeout(() => openMenu(clientX, clientY), MENU_DELAY_MS);
});
faceEl.addEventListener("mouseenter", () => face.setHover(true));
faceEl.addEventListener("mouseleave", () => face.setHover(false));

function openMenu(x: number, y: number): void {
  noticed();
  if (menu.visible) return menu.close();
  const skinItems: MenuItem[] = SKIN_IDS.map((id) => ({
    label: SKINS[id].name,
    active: skin.id === id,
    action: () => {
      applySkin(SKINS[id]);
      say(greet(mood, ctx));
    },
  }));
  menu.open(x + 12, y, [
    [
      { label: "🍔 Food", action: dropFood },
      { label: "🏃 Treadmill", action: placeTreadmill },
    ],
    [
      { label: "♪ Sing", action: sing },
      { label: "💬 Talk", action: talk },
    ],
    skinItems.slice(0, 3),
    skinItems.slice(3),
    [
      {
        label: mood === "creepy" ? "😊 Friendly" : "😈 Creepy",
        action: () => {
          setMood(mood === "friendly" ? "creepy" : "friendly");
          say(greet(mood, ctx));
        },
      },
      { label: voice.muted ? "🔊 Sound on" : "🔇 Mute", action: toggleSound },
      { label: pesterOn ? "👉 Pester: on" : "👉 Pester: off", action: togglePester },
    ],
    [{ label: autostartOn ? "🚀 Start with PC: on" : "🚀 Start with PC: off", action: toggleAutostart }],
  ]);
}

function toggleSound(): void {
  voice.muted = !voice.muted;
  save("muted", voice.muted ? "1" : "0");
  say(voice.muted ? "Okay, I'll be quiet... tee hee" : "I can sing again! ♪");
}

onTray((id) => {
  voice.unlock();
  noticed();
  if (id === "talk") talk();
  else if (id === "sing") sing();
  else if (id === "recall") buddy.recall();
  else if (id === "sound") toggleSound();
  else if (id === "creepy") {
    setMood(mood === "friendly" ? "creepy" : "friendly");
    say(greet(mood, ctx));
  } else if (id.startsWith("skin:")) {
    const next = id.slice("skin:".length);
    if (isSkinId(next)) {
      applySkin(SKINS[next]);
      say(greet(mood, ctx));
    }
  }
});

window.addEventListener("resize", () => (regionsDirty = true));

// ---------- Idle chatter ----------

function scheduleIdleChatter(): void {
  window.setTimeout(() => {
    if (!speech.visible && !singing && !buddy.busy) {
      if (Math.random() < SING_CHANCE) sing();
      else talk();
    }
    if (mood === "creepy" && Math.random() < 0.5) face.twitch();
    scheduleIdleChatter();
  }, 60_000 + Math.random() * 120_000);
}

// ---------- Start ----------

async function start(): Promise<void> {
  ctx.user = await getUsername();
  applySkin(skin);
  setMood(mood);
  onStateChange(buddy.state);
  requestAnimationFrame(frame);
  window.setTimeout(() => say(greet(mood, ctx)), 1200);
  scheduleIdleChatter();
  void initAutostart();
  window.setTimeout(checkForUpdate, UPDATE_FIRST_CHECK_MS);
  if (!inTauri) {
    document.body.style.background = "#556"; // see him in a plain browser
    // Browser preview has no tray; expose the actions for testing.
    Object.assign(window, {
      verity: { sing, talk, dropFood, placeTreadmill, skin: (id: string) => isSkinId(id) && applySkin(SKINS[id]) },
    });
    const params = new URLSearchParams(location.search);
    const previewSkin = params.get("skin");
    if (previewSkin && isSkinId(previewSkin)) applySkin(SKINS[previewSkin]);
    // e.g. ?do=food,food,treadmill — queue actions one second apart.
    const demo: Record<string, () => void> = {
      food: dropFood,
      treadmill: placeTreadmill,
      sing,
      puke,
      creepy: () => setMood("creepy"),
      pester: () => (lastNoticed = -Infinity),
    };
    (params.get("do") ?? "").split(",").forEach((a, i) => demo[a] && window.setTimeout(demo[a], 2500 + i * 1000));
  }
}

void start();

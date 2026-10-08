import { Buddy, type Side, type State } from "./buddy";
import { BALL_FILL, Face, type Mouth, type Press } from "./face";
import { calmLines, comeback, crashoutLines, dizzyLines, greet, moodForHour, ouchLines, pick, quiz, randomLine, render, type Context, type Mood, type Stats } from "./lines";
import { ContextMenu, type MenuItem } from "./menu";
import {
  cursorTo,
  discordStatus,
  getUptime,
  getUsername,
  inTauri,
  onCursor,
  onFakeQuit,
  onSetting,
  onTray,
  onWardrobe,
  openSettings,
  scrollActive,
  setHitRegions,
  type Rect,
} from "./native";
import { emit } from "./particles";
import { Prop, spawnFood, spawnPuke, Treadmill } from "./props";
import { isSkinId, SKIN_IDS, SKINS, type Skin } from "./skins";
import { BEAT_S, snippets, vowelOf } from "./song";
import { Speech } from "./speech";
import { load, loadWardrobe, save, saveSetting, setting } from "./store";
import { autostartState, findUpdate, installUpdate, setAutostart } from "./updates";
import { Voice } from "./voice";
import { accessory, parseWorn, wornHeight, type AccessoryId } from "./wardrobe";

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
const UPDATE_EVERY_MS = 10 * 60_000;
const PET_DELAY_MS = 120; // a right-click waits this long in case the left button joins (squeeze)
const SQUEEZE_FULL_MS = 1100; // time to squeeze all the way
const EDGE_SQUISH_PX = 110; // pushing this far into an edge squishes him fully
const SHAKE_SPEED = 700; // px/s drag speed that counts as a shake stroke
const SHAKE_STROKES = 5; // direction changes within SHAKE_WINDOW_MS
const SHAKE_WINDOW_MS = 1400;
const FOOD_TO_OBESITY = 3;
const TREADMILL_SPEED = 230; // px/s the belt "moves" (drives his rolling)
const WORKOUT_MS = 9000;
const THROW_SPEED = 600; // px/s release speed that counts as a throw
const JUMPSCARE_MS = 2600; // zoom in, hold, zoom back out: under 3 s
const CRASHOUT_MS = 30_000; // then he pesters you this long, and can't be clicked
const CRASHOUT_SHOVE_MS = 2200; // how often he drags your cursor around meanwhile
const CRASHOUT_SPEED = 2.5; // he rolls this much faster while crashing out
const PIN_MS = 33; // how often the cursor he's pushing is put back against him
const PUSH_MAX_MS = 5000; // a push that never arrives lets go of the cursor after this long
const BREAK_FREE_PX = 60; // pull the cursor this far off him...
const BREAK_FREE_STROKES = 4; // ...back and forth this many times...
const BREAK_FREE_MS = 1200; // ...this quickly to shake it free
const SCROLL_STEP_MS = 140; // one line scrolled per step while he rolls on the spot
const ROLL_SPEED = 260; // px/s he spins on the spot while scrolling
const PET_FRAMES = 10; // the PetPet hand: one pass of its 10 frames
const PET_FRAME_MS = 30;

const stageEl = document.getElementById("stage")!;
const vignetteEl = document.getElementById("vignette")!;
const buddyEl = document.getElementById("buddy")!;
const faceEl = document.getElementById("verity")!;
const bubbleEl = document.getElementById("bubble")!;

const savedSkin = load("skin") ?? "verity";
let skin: Skin = SKINS[isSkinId(savedSkin) ? savedSkin : "verity"];
let mood: Mood = moodForHour(new Date());
let cursor: { x: number; y: number } | null = null;
let cursorAt = 0;
let singing = false;

function loadStats(): Stats {
  const fresh: Stats = { clicks: 0, throws: 0, feeds: 0, closes: 0 };
  try {
    const saved = JSON.parse(load("stats") ?? "{}");
    for (const k of Object.keys(fresh) as (keyof Stats)[]) fresh[k] = Number(saved?.[k]) || 0;
    return fresh;
  } catch {
    return fresh;
  }
}

function count(stat: keyof Stats): void {
  ctx.stats[stat]++;
  save("stats", JSON.stringify(ctx.stats));
}

const ctx: Context = { user: "friend", now: new Date(), skin, uptime: null, startedAt: new Date(), stats: loadStats() };
// Uptime is read once at start and advanced from the clock after that.
let uptimeAtStart: number | null = null;

function refreshCtx(): void {
  ctx.now = new Date();
  ctx.uptime = uptimeAtStart === null ? null : uptimeAtStart + (ctx.now.getTime() - ctx.startedAt.getTime()) / 1000;
}
const voice = new Voice();
// Before 0.3 sound had its own key, "muted".
if (load("sound") === null && load("muted") === "1") saveSetting("sound", false);
voice.muted = !setting("sound");
const face = new Face(faceEl, SIZE, skin);
let worn = loadWardrobe();
face.setWardrobe(worn);
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
  updatePresence();
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
  updatePresence();
  if (mood === "creepy") {
    face.twitch();
    if (!wasCreepy) {
      voice.static(0.5);
      window.setTimeout(() => voice.laugh(), 600);
      scheduleCreepyAntics();
    }
  }
}

// ---------- Discord status ----------

/** What Discord shows: who he is and what mood he's in. Nothing while he's pretending to have quit. */
function updatePresence(): void {
  if (gone || !setting("discord")) return discordStatus(null);
  const state = untouchable() ? "CRASHING OUT" : mood === "creepy" ? "Watching you. tee hee" : "Being nice ☺";
  discordStatus({ details: `Hanging out with ${skin.name}`, state });
}

// ---------- Evil mode antics: glitching and teleporting next to your cursor ----------

let creepyTimer = 0;

function scheduleCreepyAntics(): void {
  window.clearTimeout(creepyTimer);
  creepyTimer = window.setTimeout(() => {
    if (mood !== "creepy") return;
    if (gone) return scheduleCreepyAntics();
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
  if (singing || gone) return;
  buddy.hold(performance.now(), 6000);
  speech.say(line, mood, choices, onChoice);
}

function talk(): void {
  refreshCtx();
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
  if (singing || buddy.busy || gone) return;
  const options = snippets(skin);
  const notes = options[Math.floor(Math.random() * options.length)];
  singing = true;
  buddy.hold(performance.now(), 60_000);

  let lyric = "♪";
  let t = 0;
  notes.forEach((note, i) => {
    const dur = note.beats * BEAT_S;
    window.setTimeout(() => {
      if (gone) return;
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
let pesterOn = setting("pester");

/** Any interaction with him resets the "ignored" timer. */
function noticed(): void {
  lastNoticed = performance.now();
}

function maybePester(now: number): void {
  if (gone || !pesterOn || now - lastNoticed < PESTER_AFTER_MS) return;
  if (!buddy.grounded || buddy.busy || singing || squeezing) return;
  lastNoticed = now; // and again after another round of being ignored
  say(pick(["Hey! {user}! Look at me!", "Psst... {user}...", "I'm bored. Play with me!", "Hellooo? Anyone there?"], ctx));
  // Roll over to the cursor if we know where it is (not always possible on Wayland).
  const fresh = cursor && now - cursorAt < CURSOR_FRESH_MS;
  buddy.seek(fresh ? cursor!.x : centre().x, pushCursor);
}

/** Pushes your cursor away, then scrolls your page down and back up. */
function pushCursor(): void {
  if (gone) return;
  const mid = centre().x;
  const dir = mid > innerWidth / 2 ? -1 : 1;
  pushCursorTo(mid + dir * (220 + Math.random() * 180), () => {
    say("I moved your cursor. tee hee");
    window.setTimeout(() => {
      scrollRoll(4);
      window.setTimeout(() => scrollRoll(-4), 4 * SCROLL_STEP_MS + 600);
    }, 800);
  });
}

// ---------- Pushing your cursor, and rolling on the spot while scrolling ----------
// While he pushes, the cursor is pinned against his front and the whole window
// holds on to the mouse. Only shaking it hard back and forth breaks it free.

let pushUntil = 0; // while now < pushUntil he's pushing the cursor
let pushDir = 0;
let pushRound = 0; // a push that was broken free doesn't finish
let pinnedAt: { x: number; y: number } | null = null;
let lastPin = 0;
const pulls: number[] = [];
let lastPullSign = 0;
let rollUntil = 0;
let rollDir = 0;

function pushing(): boolean {
  return performance.now() < pushUntil;
}

/** Put your cursor against his front and roll to x, pushing it along; then call done. */
function pushCursorTo(x: number, done: () => void): void {
  const round = ++pushRound;
  pushDir = Math.sign(x - centre().x) || 1;
  pushUntil = performance.now() + PUSH_MAX_MS;
  pulls.length = 0;
  lastPullSign = 0;
  regionsDirty = true;
  pin(performance.now(), true);
  buddy.seek(x, () => {
    if (round !== pushRound) return;
    pushUntil = 0;
    regionsDirty = true;
    if (!gone) done();
  });
}

/** Puts the cursor back against the side he's rolling towards. */
function pin(now: number, force = false): void {
  if (!force && now - lastPin < PIN_MS) return;
  lastPin = now;
  pinnedAt = { x: centre().x + pushDir * (buddy.w / 2 + 4), y: buddy.y + buddy.h * 0.55 };
  cursorTo(pinnedAt.x, pinnedAt.y).catch(() => {});
}

/** Every cursor position while he pushes: yanking it hard back and forth breaks it free. */
function struggle(x: number, y: number): void {
  if (!pushing() || !pinnedAt) return;
  const dx = x - pinnedAt.x;
  const dy = y - pinnedAt.y;
  const pull = Math.abs(dx) > Math.abs(dy) ? dx : dy;
  if (Math.abs(pull) < BREAK_FREE_PX || Math.sign(pull) === lastPullSign) return;
  lastPullSign = Math.sign(pull);
  const now = performance.now();
  pulls.push(now);
  while (pulls.length && now - pulls[0] > BREAK_FREE_MS) pulls.shift();
  if (pulls.length >= BREAK_FREE_STROKES) breakFree(now);
}

function breakFree(now: number): void {
  pushRound++;
  pushUntil = 0;
  regionsDirty = true;
  buddy.stop(now);
  buddy.hop(0.5);
  face.flashEyes("dizzy", 1200);
  voice.oof();
  say(pick(mood === "creepy" ? ["Strong, {user}. tee hee", "You got away. For now."] : ["Hey! Fine, keep it. tee hee", "Okay okay! You win!"], ctx));
}

/** Scroll your page a line at a time while he rolls on the spot: forwards for down, backwards for up. */
function scrollRoll(lines: number): void {
  if (gone || lines === 0) return;
  const steps = Math.abs(lines);
  const dir = Math.sign(lines);
  const now = performance.now();
  rollDir = dir;
  rollUntil = now + steps * SCROLL_STEP_MS + 150;
  buddy.hold(now, steps * SCROLL_STEP_MS + 400);
  for (let i = 0; i < steps; i++)
    window.setTimeout(() => {
      if (!gone) scrollActive(dir);
    }, i * SCROLL_STEP_MS);
}

// ---------- Starting with the PC, and updating himself ----------

/** On unless switched off in settings; re-registered every start so it follows the app if it moves. */
async function initAutostart(): Promise<void> {
  // Before 0.3 it was turned on once ("autostartSet") and could be switched off in the menu.
  if (load("autostart") === null && load("autostartSet") !== null) {
    try {
      saveSetting("autostart", await autostartState());
    } catch {
      /* couldn't tell; ask again next start */
    }
  }
  if (setting("autostart")) await setAutostart(true).catch(() => {});
}

let updatesPaused = false; // "Later": no more asking until he's restarted (Settings can still update)

async function checkForUpdate(): Promise<void> {
  if (updatesPaused) return;
  const update = await findUpdate();
  if (update && !updatesPaused) {
    say(`A new version of me is here (v${update.version})! Update now?`, ["Update", "Later"], (choice) => {
      if (choice !== "Update") {
        updatesPaused = true;
        return say("Okay, later! I won't ask again until you restart me. tee hee");
      }
      say("Updating... see you in a sec! tee hee");
      installUpdate(update).catch(() => say("The update didn't work. I'll try again later."));
    });
  }
  window.setTimeout(checkForUpdate, UPDATE_EVERY_MS);
}

// ---------- Pretending to quit, and crashing out when he comes back ----------
// Quit in the tray sometimes only pretends (decided in the backend): he goes
// invisible and click-through, and the backend calls him back later. Then he
// crashes out: grabs your cursor, jumpscares you, and pesters you for a while
// without letting you touch him, before calming down.

let gone = false;
let zoomStart = -Infinity; // when the jumpscare started
let untouchableUntil = 0;
let crashRound = 0; // timers from an earlier crashout check this and stop

function untouchable(): boolean {
  return performance.now() < untouchableUntil;
}

function vanish(): void {
  gone = true;
  crashRound++;
  pushUntil = 0;
  pushRound++;
  rollUntil = 0;
  petStart = -Infinity;
  handEl.classList.remove("on");
  if (buddy.state === "exercise") {
    buddy.stepOff();
    treadmill?.setRunning(false);
    workoutUntil = 0;
  }
  menu.close();
  speech.hide();
  stageEl.style.visibility = "hidden";
  vignetteEl.style.visibility = "hidden";
  updatePresence();
  regionsDirty = true;
}

function crashOut(): void {
  gone = false;
  count("closes");
  refreshCtx();
  stageEl.style.visibility = "";
  vignetteEl.style.visibility = "";
  setMood("creepy");
  buddy.teleport(cursor ? cursor.x : Math.random() * innerWidth);
  playClass(faceEl, "appear", 400);
  voice.static(0.6);
  noticed();
  // Make you look at him.
  const { x, y } = centre();
  cursorTo(x, y + buddy.h / 2).catch(() => {});

  const now = performance.now();
  const scare = setting("jumpscare");
  if (scare) {
    save("jumpscareSeen", "1"); // the settings window shows the switch from now on
    zoomStart = now;
    voice.static(1.4);
    window.setTimeout(() => voice.laugh(), 250);
  }
  const pesterAt = scare ? JUMPSCARE_MS : 600;
  untouchableUntil = now + pesterAt + CRASHOUT_MS;
  regionsDirty = true;
  updatePresence();
  const round = ++crashRound;
  buddy.physics = { walkSpeed: skin.walkSpeed * CRASHOUT_SPEED, bounce: skin.bounce };
  let shoves = 0;
  window.setTimeout(() => {
    if (round !== crashRound) return;
    say(comeback(ctx));
    shoves = window.setInterval(() => (round === crashRound ? shove() : window.clearInterval(shoves)), CRASHOUT_SHOVE_MS);
  }, pesterAt);
  window.setTimeout(() => {
    window.clearInterval(shoves);
    if (round === crashRound) calmDown();
  }, pesterAt + CRASHOUT_MS);
}

/** One round of crashing out: push your cursor across the screen, scroll your page, yell. */
function shove(): void {
  if (gone) return;
  voice.static(0.15);
  playClass(faceEl, "glitch", 400);
  if (!speech.visible) say(pick(crashoutLines, ctx));
  if (!buddy.grounded || buddy.busy) return;
  const mid = centre().x;
  let target = Math.random() * innerWidth;
  if (Math.abs(target - mid) < 250) target = mid + (mid > innerWidth / 2 ? -1 : 1) * (250 + Math.random() * 200);
  pushCursorTo(target, () => {
    if (Math.random() < 0.6) scrollRoll(Math.random() < 0.5 ? 5 : -5);
  });
}

function calmDown(): void {
  untouchableUntil = 0;
  regionsDirty = true;
  buddy.physics = { walkSpeed: skin.walkSpeed, bounce: skin.bounce };
  if (gone) return;
  setMood("friendly");
  speech.hide();
  say(pick(calmLines, ctx));
  giggle();
}

/** The jumpscare: he zooms at your face, shakes, and shrinks back. Null when not running. */
function jumpscare(now: number): { scale: number; pull: number; jitter: number } | null {
  const t = now - zoomStart;
  if (t < 0 || t >= JUMPSCARE_MS) return null;
  const peak = (1.1 * innerHeight) / buddy.h; // his whole face fills the screen
  const ease = (k: number) => 1 - (1 - k) ** 3;
  const k = t < 250 ? ease(t / 250) : t < 1900 ? 1 : 1 - ease((t - 1900) / (JUMPSCARE_MS - 1900));
  return { scale: 1 + (peak - 1) * k, pull: k, jitter: t < 1900 ? 24 : 0 };
}

// ---------- Petting (right click): the PetPet hand pats him once ----------
// Each right-click starts the pat over, so it can be spammed.

let petStart = -Infinity;
const handFrames = Array.from({ length: PET_FRAMES }, (_, i) => {
  const img = new Image();
  img.src = `/petpet/pet${i}.gif`;
  return img;
});
const handEl = document.createElement("img");
handEl.id = "hand";
handEl.alt = "";
stageEl.append(handEl);

function pet(): void {
  if (gone || untouchable() || pushing()) return;
  const now = performance.now();
  const started = (petStart = now);
  const total = PET_FRAMES * PET_FRAME_MS;
  noticed();
  buddy.hold(now, total + 800);
  handEl.classList.add("on");
  speech.hide();
  face.flashEyes("happy", total + 400);
  voice.squeak();
  window.setTimeout(() => {
    if (petStart !== started) return; // petted again meanwhile
    handEl.classList.remove("on");
    if (gone) return;
    giggle();
    const { x, y } = centre();
    for (let i = 0; i < 4; i++) emit(stageEl, x + (Math.random() - 0.5) * buddy.w, y, "💛", skin.particleColor);
    if (Math.random() < 0.3) say(pick(mood === "creepy" ? ["...again.", "Don't stop. tee hee"] : ["tee hee ☺", "More pets please!", "I'm a good ball. ☺"], ctx));
  }, total);
}

/** Which frame of the hand is showing, or null when not petting. */
function petFrame(now: number): number | null {
  const t = now - petStart;
  return t < 0 || t >= PET_FRAMES * PET_FRAME_MS ? null : Math.floor(t / PET_FRAME_MS);
}

/** How much he's squashed on a frame, as in the PetPet generator: up to a quarter of his height at the middle frame. */
function petSquash(frame: number): number {
  const j = frame < PET_FRAMES / 2 ? frame : PET_FRAMES - frame;
  return (0.0625 * j) / 0.45; // as a share of the face's maximum squash
}

/**
 * Lays the hand frame over him the way the generator lays it over the avatar:
 * the avatar sits at 20%–100% across and 12%–92% down the frame.
 */
function placeHand(frame: number): void {
  const src = handFrames[frame].src;
  if (handEl.src !== src) handEl.src = src;
  const size = buddy.w / 0.8;
  handEl.style.width = `${size}px`;
  handEl.style.transform = `translate(${buddy.x - 0.2 * size}px, ${buddy.y + buddy.h - 0.92 * size}px)`;
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
  if (gone || !buddy.grounded || buddy.busy || singing || squeezing || now < sickUntil) return;
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
  count("feeds");

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
  const whole = [{ x: 0, y: 0, w: innerWidth, h: innerHeight }];
  // While pushing your cursor he holds on to the whole screen's mouse input.
  const rects = gone
    ? []
    : pushing()
    ? whole
    : untouchable()
    ? []
    : pressing
    ? whole
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
  // Above his head (and his hat), unless he's near the top of the screen.
  const hat = wornHeight(worn) * ((SIZE * skin.shape[1] * BALL_FILL) / 2);
  const above = buddy.y - hat - h - BUBBLE_GAP;
  const top = above > 8 ? above : buddy.y + buddy.h + BUBBLE_GAP;
  bubbleEl.style.transform = `translate(${left}px, ${top}px)`;
  bubbleEl.style.setProperty("--tail", `${Math.max(20, Math.min(w - 20, mid - left))}px`);
}

// ---------- Main loop ----------

let prev = performance.now();
let pressed = false; // whether a press was applied last frame, so it can be let go
let squished = false; // pushed into a screen edge last frame
function frame(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const [x0, y0] = [buddy.x, buddy.y];
  buddy.step(dt, now);

  // Squeezing, petting, leaning into the cursor he's pushing; molding into edges and corners.
  const petting = petFrame(now);
  const pushingNow = pushing();
  if (!pushingNow && pushUntil) {
    pushUntil = 0;
    regionsDirty = true;
  }
  let press: Press | null = null;
  if (squeezing) {
    press = { side: "squeeze", amount: Math.min(1, (now - squeezeStart) / SQUEEZE_FULL_MS) };
    face.flashEyes("squeeze", 100);
  } else if (petting !== null) {
    press = { side: "floor", amount: petSquash(petting), snap: true };
  } else if (pushingNow && buddy.state === "walk") {
    press = { side: pushDir > 0 ? "right" : "left", amount: 0.3 };
  }
  if (press || pressed) face.setPress(press);
  pressed = press !== null;
  const p = buddy.state === "drag" ? buddy.pressure : null;
  // Squashed into an edge: squeak when it starts, squint while it's hard.
  if (p && !squished) voice.squeak();
  if (p && Math.hypot(p.x, p.y) > 30) face.flashEyes("squeeze", 120);
  squished = p !== null;
  faceEl.classList.toggle("squished", squished); // no dangling while pressed into a wall
  face.setPush(p && [Math.sign(p.x) * Math.min(Math.abs(p.x), EDGE_SQUISH_PX), Math.sign(p.y) * Math.min(Math.abs(p.y), EDGE_SQUISH_PX)]);
  if (petting !== null) placeHand(petting);
  if (pushingNow) pin(now);

  let [vx, vy] = buddy.velocity;
  let dx = buddy.x - x0;
  if (buddy.state === "exercise") {
    dx = TREADMILL_SPEED * dt; // running on the spot
    vx = TREADMILL_SPEED;
    vy = 0;
  }
  // Rolling on the spot while scrolling: towards you for down, away for up.
  const spin = now < rollUntil && buddy.state === "idle" ? rollDir * ROLL_SPEED * dt : 0;
  face.update(dt, { dx, dy: buddy.y - y0, vx, vy, state: buddy.state, spin });
  const scare = jumpscare(now);
  if (scare) {
    // Pulled to the middle of the screen as he grows, shaking.
    const jx = (Math.random() - 0.5) * scare.jitter;
    const jy = (Math.random() - 0.5) * scare.jitter;
    const x = buddy.x + (innerWidth / 2 - buddy.w / 2 - buddy.x) * scare.pull + jx;
    const y = buddy.y + (innerHeight / 2 - buddy.h / 2 - buddy.y) * scare.pull + jy;
    buddyEl.style.transform = `translate(${x}px, ${y}px) scale(${scare.scale})`;
  } else {
    buddyEl.style.transform = `translate(${buddy.x}px, ${buddy.y}px)`;
  }

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
  struggle(x, y);
  cursor = { x, y };
  cursorAt = performance.now();
  if (performance.now() - lastLocal > 300) face.lookAt(x, y);
});
window.addEventListener("mousemove", (e) => {
  struggle(e.clientX, e.clientY);
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
let petTimer = 0;
const BOTH_BUTTONS = 3;

faceEl.addEventListener("mousedown", (e) => {
  if (untouchable() || pushing()) return;
  voice.unlock();
  noticed();
  if (e.button === 1) {
    e.preventDefault(); // no autoscroll or paste
    return openMenu(e.clientX, e.clientY);
  }
  if (e.button !== 0) return;
  if (menu.visible) menu.close();
  window.clearTimeout(petTimer);
  petTimer = 0;
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
    if (Math.hypot(buddy.vx, buddy.vy) > THROW_SPEED) count("throws");
    if (mood === "friendly" && Math.hypot(buddy.vx, buddy.vy) > 900 && Math.random() < 0.4) say("Wheee! ☺");
  } else if (press && !wasSqueezing) {
    count("clicks");
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
  if (!faceEl.contains(e.target as Node) || untouchable()) return;
  // Spamming right-click restarts the pat each time; don't keep postponing it.
  if (!petTimer)
    petTimer = window.setTimeout(() => {
      petTimer = 0;
      pet();
    }, PET_DELAY_MS);
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
      { label: "👒 Wardrobe", action: openSettings },
      { label: "⚙ Settings", action: openSettings },
    ],
  ]);
}

/** Dressed from the wardrobe: he shows off whatever he just put on. */
function dress(next: AccessoryId[]): void {
  const added = next.find((id) => !worn.includes(id));
  worn = next;
  face.setWardrobe(next);
  if (added) {
    face.giggle();
    say(render(accessory(added)!.line, ctx));
  }
}
onWardrobe(dress);

// Changes made in the settings window. Autostart is applied there; the
// jumpscare setting is read when it's needed.
onSetting((key, on) => {
  if (key === "sound") {
    voice.muted = !on;
    say(on ? "I can sing again! ♪" : "Okay, I'll be quiet... tee hee");
  } else if (key === "discord") {
    updatePresence();
  } else if (key === "pester") {
    pesterOn = on;
    say(on ? "I'll come find you if you ignore me. tee hee" : "Fine. I'll leave your cursor alone.");
  }
});

onTray((id) => {
  voice.unlock();
  noticed();
  if (id === "talk") talk();
  else if (id === "sing") sing();
  else if (id === "recall") buddy.recall();
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

onFakeQuit(vanish, crashOut);

window.addEventListener("resize", () => (regionsDirty = true));

// ---------- Idle chatter ----------

function scheduleIdleChatter(): void {
  window.setTimeout(() => {
    if (!speech.visible && !singing && !buddy.busy && !gone) {
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
  uptimeAtStart = await getUptime();
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
    // e.g. ?wear=master,shades
    const wear = params.get("wear");
    if (wear) dress(parseWorn(JSON.stringify(wear.split(","))));
    // e.g. ?do=food,food,treadmill — queue actions one second apart.
    const demo: Record<string, () => void> = {
      food: dropFood,
      treadmill: placeTreadmill,
      sing,
      puke,
      creepy: () => setMood("creepy"),
      pester: () => (lastNoticed = -Infinity),
      pet,
      scroll: () => scrollRoll(5),
      scrollup: () => scrollRoll(-5),
      fakequit: () => {
        vanish();
        window.setTimeout(crashOut, 3000);
      },
    };
    (params.get("do") ?? "").split(",").forEach((a, i) => demo[a] && window.setTimeout(demo[a], 2500 + i * 1000));
  }
}

void start();

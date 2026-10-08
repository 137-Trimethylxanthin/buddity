import { Buddy, type Side, type State } from "./buddy";
import { BALL_FILL, Face, type Mouth, type Press } from "./face";
import { calmLines, comeback, crashoutLines, dizzyLines, greet, moodForHour, ouchLines, pauseLines, pick, placeLines, quiz, randomLine, render, songLines, type Context, type Mood, type Stats } from "./lines";
import { ContextMenu, type MenuItem } from "./menu";
import {
  cursorTo,
  discordStatus,
  getPcInfo,
  getScreens,
  getUptime,
  getUsername,
  inTauri,
  moveToScreen,
  onMirrorShown,
  sendMirror,
  onCursor,
  onFakeQuit,
  appWindowsFast,
  onAppWindows,
  onMusic,
  onSetting,
  onTray,
  onWardrobe,
  openSettings,
  scrollActive,
  setHitRegions,
  setAppWindows,
  setMusic,
  type AppWindow,
  type Rect,
  type Screen,
  type Track,
} from "./native";
import { emit } from "./particles";
import { Music, songKey, type LyricLine } from "./music";
import { appName, ledges, placeOf, sameApp, toBoxes, type Place, type WindowBox } from "./places";
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
const PC_INFO_EVERY_MS = 60_000;
const ROAM_CHANCE = 0.2; // of idle chatter turning into a trip to another screen
const EXPLORE_CHANCE = 0.3; // of idle chatter turning into a visit to some app's window
const MUSIC_WINDOW_PULL = 0.7; // while music plays, how often that visit is to the music app
const PLACE_SETTLE_MS = 2500; // somewhere this long before he remarks on it
const PLACE_REMARK_CHANCE = 0.3;
const WINDOW_HIT_SPEED = 250; // px/s: a window dragged into him faster than this knocks him away
const SONG_REACT_CHANCE = 0.6; // says something about a new song
const SONG_DANCE_CHANCE = 0.6; // dances to a new song
const DANCE_MS: [number, number] = [15_000, 35_000];
const SING_ALONG_CHANCE = 0.7; // per song, he sings a few lines of it at some point
const SING_ALONG_LINES: [number, number] = [2, 4];
const LYRIC_LINE_MAX_MS = 4500; // the bubble doesn't stay up longer than this per line

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

const ctx: Context = { user: "friend", now: new Date(), skin, uptime: null, startedAt: new Date(), stats: loadStats(), pc: null, music: null, place: null };
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
  // Scrolling goes to the window under the cursor: put it on him, so it's the window he's in that scrolls.
  if (ctx.place) {
    const { x } = centre();
    cursorTo(x, buddy.y + buddy.h / 2).catch(() => {});
  }
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

/** Gone, or crashing out: nothing (windows, songs, dancing) gets to push him around. */
function invulnerable(): boolean {
  return gone || untouchable();
}

function vanish(): void {
  stopSinging();
  stopDance();
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
  stopSinging();
  stopDance();
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
  updateDance(now);
  updateCrossing();
  updatePlace(now);
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
  // The button came up somewhere we didn't hear about (e.g. while the window moved screens).
  if ((e.buttons & 1) === 0) return letGo();
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
  if (buddy.state !== "drag" && press && !wasSqueezing) {
    count("clicks");
    talk();
  }
  letGo();
});

/** The left button is up: a held Verity is thrown (or just dropped). */
function letGo(): void {
  pressing = false;
  if (buddy.state === "drag") {
    face.setPress(null);
    buddy.release();
    if (Math.hypot(buddy.vx, buddy.vy) > THROW_SPEED) count("throws");
    if (mood === "friendly" && Math.hypot(buddy.vx, buddy.vy) > 900 && Math.random() < 0.4) say("Wheee! ☺");
  }
  press = null;
  regionsDirty = true;
}
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

// ---------- Several screens ----------
// The character window covers one screen, and every screen has a mirror window.
// Screens side by side form one wide floor: his walls are the outer edges, so
// he moves straight through the edges between screens. While he overlaps an
// edge the mirrors draw him (on both screens, so there's no seam) and this
// window hides its copy; once his middle is past the edge this window moves to
// that screen. Never mid-drag: moving the window would end the drag, so he can
// be dragged onto the next screen and the window follows when he's let go.

let roamOn = setting("screens");
let knownScreens: Screen[] = [];
let here: number | null = null; // the screen his coordinates are relative to
let hopping = false; // the window is on its way to another screen
let mirroring = false;

async function refreshScreens(): Promise<void> {
  knownScreens = await getScreens();
  if (!hopping) here = knownScreens.findIndex((s) => s.current);
  updateBounds();
  updatePlaces(false);
}

/** Screens he can cross into: side by side with mirrors, chained from this one. */
function connectedRange(): { left: number; right: number } | null {
  const cur = here === null ? undefined : knownScreens[here];
  if (!cur || !cur.mirror) return null;
  let left = cur.x;
  let right = cur.x + cur.w;
  // Grow the floor sideways while the next screen over has a mirror.
  for (;;) {
    const l = knownScreens.find((s) => s.mirror && Math.abs(s.x + s.w - left) <= 8 && s.y < cur.y + cur.h && s.y + s.h > cur.y);
    if (!l) break;
    left = l.x;
  }
  for (;;) {
    const r = knownScreens.find((s) => s.mirror && Math.abs(s.x - right) <= 8 && s.y < cur.y + cur.h && s.y + s.h > cur.y);
    if (!r) break;
    right = r.x + r.w;
  }
  return right - left > cur.w ? { left, right } : null;
}

/** Walls on the outermost screens, unless things on this screen keep him here. */
function updateBounds(): void {
  const range = roamOn && !treadmill && foods().length === 0 ? connectedRange() : null;
  const cur = here === null ? undefined : knownScreens[here];
  buddy.bounds =
    range && cur ? { left: (range.left - cur.x) / cur.scale, right: (range.right - cur.x) / cur.scale } : null;
}

/** Physical x of a window x, on the screen his coordinates are relative to. */
function physicalX(x: number): number | null {
  const cur = here === null ? undefined : knownScreens[here];
  return cur ? cur.x + x * cur.scale : null;
}

/**
 * Each frame: draw him in the mirrors while he overlaps an edge, and follow
 * him onto the next screen. While he's held, this window keeps drawing its own
 * part (the part under your cursor stays snappy) and only the other screen's
 * mirror draws the rest. Otherwise the mirrors draw all of him, so both halves
 * line up exactly; this window hides its copy once they've shown a frame.
 */
function updateCrossing(): void {
  updateBounds(); // food or the treadmill keep him on this screen
  const cur = here === null ? undefined : knownScreens[here];
  if (!buddy.bounds || !cur || gone) {
    if (mirroring) stopMirroring();
    return;
  }
  // His middle went past an edge: this window moves to that screen. Not while he's held:
  // the moved window doesn't get the mouse back, so it follows once he's let go.
  const mid = buddy.x + buddy.w / 2;
  if (!hopping && buddy.state !== "drag" && (mid < 0 || mid > cur.w / cur.scale)) void follow(physicalX(mid)!);

  const over = buddy.x < -2 || buddy.x + buddy.w > cur.w / cur.scale + 2;
  if (!over && !hopping) {
    if (mirroring) stopMirroring();
    return;
  }
  const held = buddy.state === "drag";
  if (!mirroring || held !== mirrorHeld) {
    // A new crossing, or he was picked up or let go: wait for the mirrors to catch up again.
    mirroring = true;
    mirrorHeld = held;
    mirrorSession++;
  }
  // Hidden while the window is moving, and once the mirror on this screen is drawing him too.
  const mirrored = !held && mirrorShown.session === mirrorSession && mirrorShown.screen === here;
  faceEl.style.visibility = hopping || mirrored ? "hidden" : "";
  sendMirror({
    session: mirrorSession,
    owner: hopping ? null : here,
    ownerDraws: held && !hopping,
    skin: skin.id,
    worn,
    cls: faceEl.className,
    x: physicalX(buddy.x)!,
    bottom: (innerHeight - buddy.y - buddy.h) * cur.scale,
    pose: face.pose(),
  });
}

let mirrorSession = 0;
let mirrorHeld = false;
let mirrorShown = { session: -1, screen: -1 }; // the latest frame a mirror has drawn
onMirrorShown((shown) => {
  if (shown.session >= mirrorShown.session) mirrorShown = shown;
});

function stopMirroring(): void {
  mirroring = false;
  faceEl.style.visibility = "";
  sendMirror(null);
}

/** Move this window to the screen at physical x, keeping him exactly where he is on the desktop. */
async function follow(physX: number): Promise<void> {
  const next = knownScreens.findIndex((s) => s.mirror && physX >= s.x && physX < s.x + s.w);
  const cur = here === null ? undefined : knownScreens[here];
  if (next < 0 || next === here || !cur) return;
  const to = knownScreens[next];
  hopping = true;
  // Switch coordinates now, so the mirrors never see a jump.
  buddy.shift((cur.x - to.x + buddy.x * (cur.scale - to.scale)) / to.scale);
  here = next;
  updateBounds();
  updatePlaces(false);
  speech.hide();
  menu.close();
  const heightBefore = innerHeight;
  const settled = new Promise<void>((done) => {
    window.addEventListener("resize", () => done(), { once: true });
    window.setTimeout(done, 300); // same-size screens don't resize the window
  });
  const moved = await moveToScreen(next);
  if (moved) await settled;
  // Keep his height above the floor if this screen's window is taller or shorter (bars).
  buddy.y += innerHeight - heightBefore;
  updatePlaces(false);
  face.refreshPixelRatio();
  save("screen", String(next));
  hopping = false;
  lastRegionKey = ""; // the window may have been recreated on the new screen: send its click-through shape again
  regionsDirty = true;
  void refreshScreens();
}

/** Now and then he rolls off to another screen by himself. */
function roam(): boolean {
  const cur = here === null ? undefined : knownScreens[here];
  if (!buddy.bounds || !cur || !free() || partying) return false;
  const width = cur.w / cur.scale;
  const sides = [buddy.bounds.left < -1 ? -1 : 0, buddy.bounds.right > width + 1 ? 1 : 0].filter(Boolean);
  if (!sides.length) return false;
  const dir = sides[Math.floor(Math.random() * sides.length)];
  // Somewhere a few hundred px into the screen next door.
  const x = dir < 0 ? -250 - Math.random() * 500 : width + 250 + Math.random() * 500;
  buddy.seek(x, () => {});
  return true;
}

/** Start on the screen he was last on. */
async function restoreScreen(): Promise<void> {
  await refreshScreens();
  const saved = Number(load("screen") ?? NaN);
  if (!roamOn || !Number.isInteger(saved) || !knownScreens[saved] || saved === here) return;
  if (await moveToScreen(saved)) {
    window.setTimeout(() => {
      face.refreshPixelRatio();
      buddy.recall();
      regionsDirty = true;
      void refreshScreens();
    }, 300);
  }
}

// ---------- Other apps' windows ----------
// Their tops and bottoms are ledges (see places.ts); he knows which app he's
// next to, sometimes goes to visit a window, and on the window of the app
// that's playing music he parties: dances and sings every line until he's moved off.

let windowsOn = setting("windows");
let appWindows: AppWindow[] = [];
let boxes: WindowBox[] = [];
let placeKey = "";
let placeSince = 0;
let placeRemarked = true;
let partying = false;
let karaokeLine = -1;
let karaokeMouth = 0;
let fastWindows = false;

/** Rebuilds the ledges from the latest window list. carry=false when only the coordinates changed (screen switch). */
let boxesAt = 0;

function updatePlaces(carry = true): void {
  const cur = here === null ? undefined : knownScreens[here];
  const before = boxes;
  const at = performance.now();
  const dt = Math.max(0.008, (at - boxesAt) / 1000);
  boxesAt = at;
  boxes = windowsOn && cur ? toBoxes(appWindows, knownScreens, cur, innerHeight) : [];
  // On (or in) a window that's moved or resized: he's loose on it, pushed around by it.
  const ledge = buddy.standingOn?.id.match(/^(.*):(in|top)$/);
  const inside = buddy.container?.id ?? ledge?.[1] ?? null;
  const kind = buddy.container?.kind ?? (ledge?.[2] as "in" | "top" | undefined) ?? "in";
  if (inside && invulnerable()) {
    buddy.leaveBox(); // crashing out: no window holds him
  } else if (inside) {
    const now = boxes.find((b) => b.id === inside);
    const was = before.find((b) => b.id === inside);
    if (!now) buddy.leaveBox();
    else if (!carry) buddy.moveBox(now, kind, performance.now(), false);
    else if (was && (now.x !== was.x || now.y !== was.y || now.w !== was.w || now.h !== was.h)) buddy.moveBox(now, kind, performance.now());
  }
  buddy.setPlatforms(ledges(boxes, innerHeight, buddy.w, buddy.h), carry);
  if (carry) hitByWindows(before, inside, dt);
}

/** A window dragged into him knocks him away (not the one he's in or on, and not while he's crashing out). */
function hitByWindows(before: WindowBox[], mine: string | null, dt: number): void {
  if (invulnerable() || pushing() || buddy.state === "drag" || buddy.state === "exercise") return;
  const me = { x: buddy.x, y: buddy.y, w: buddy.w, h: buddy.h };
  const touches = (b: { x: number; y: number; w: number; h: number }) =>
    b.x < me.x + me.w && b.x + b.w > me.x && b.y < me.y + me.h && b.y + b.h > me.y;
  for (const b of boxes) {
    if (b.id === mine) continue;
    const was = before.find((p) => p.id === b.id);
    if (!was || (was.x === b.x && was.y === b.y)) continue; // new, or not moved (resizing doesn't hit)
    if (!touches(b) || touches(was)) continue; // only the moment it reaches him
    const vx = (b.x - was.x) / dt;
    const vy = (b.y - was.y) / dt;
    if (Math.hypot(vx, vy) < WINDOW_HIT_SPEED) continue; // drifting slowly over him is fine
    buddy.knock(vx, vy, b);
    if (Math.random() < 0.4) window.setTimeout(() => say(pick(ouchLines, ctx)), 250);
    return;
  }
}

onAppWindows((list) => {
  appWindows = list;
  updatePlaces();
});
window.addEventListener("resize", () => updatePlaces(false));

/** Each frame: where he is, and the party on the music app's window. */
function updatePlace(now: number): void {
  // Standing on a window: follow it every frame, in case it's being dragged.
  const onWindow = buddy.standingOn !== null || buddy.container !== null;
  if (onWindow !== fastWindows) {
    fastWindows = onWindow;
    appWindowsFast(onWindow);
  }
  const found = boxes.length ? placeOf(boxes, buddy.standingOn, buddy.x + buddy.w / 2, buddy.y + buddy.h / 2) : null;
  const place: Place | null = found && { app: appName(found.app), on: found.on };
  const key = place ? `${place.app}|${place.on}` : "";
  if (key !== placeKey) {
    placeKey = key;
    placeSince = now;
    placeRemarked = false;
    ctx.place = place;
  }
  // Settled somewhere new for a moment: sometimes he says so.
  if (!placeRemarked && place && now - placeSince > PLACE_SETTLE_MS && buddy.grounded) {
    placeRemarked = true;
    if (Math.random() < PLACE_REMARK_CHANCE && free()) say(pick(placeLines[mood][place.on], ctx));
  }

  const t = music.track;
  const party =
    !!place && !!t && music.playing && sameApp(t.player, place.app) &&
    !gone && !untouchable() && !pushing() && buddy.state !== "drag" && buddy.state !== "exercise";
  if (party) {
    if (!partying) {
      partying = true;
      window.clearTimeout(singAlongTimer);
      if (setting("lyrics")) void music.loadLyrics();
    }
    if (buddy.grounded) buddy.hold(now, 600); // stays until he's moved off
    dance(4000);
    karaoke();
  } else if (partying) {
    partying = false;
    endKaraoke();
  }
}

/** On the music app's window: every lyric line in the bubble as it comes up. */
function karaoke(): void {
  const lines = music.lyrics;
  const pos = music.position();
  if (!lines || pos === null) return;
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].t <= pos + 0.15) i++;
  if (i === karaokeLine) return;
  karaokeLine = i;
  window.clearInterval(karaokeMouth);
  face.setMouth("smile");
  const line = lines[i];
  // Between verses (or before the first line) the bubble goes away.
  if (!line || pos - line.t > 8) {
    if (singing) speech.hideLater(300);
    return;
  }
  singing = true; // keeps other chatter out of the bubble
  speech.show(`♪ ${line.text} ♪`, mood);
  regionsDirty = true;
  const until = performance.now() + Math.min(LYRIC_LINE_MAX_MS, ((lines[i + 1]?.t ?? line.t + 4) - line.t) * 1000);
  const mouths: Mouth[] = ["open", "o", "smile", "open"];
  let m = 0;
  karaokeMouth = window.setInterval(() => {
    if (performance.now() > until) {
      window.clearInterval(karaokeMouth);
      face.setMouth("smile");
    } else face.setMouth(mouths[m++ % mouths.length]);
  }, 160);
}

function endKaraoke(): void {
  window.clearInterval(karaokeMouth);
  face.setMouth("smile");
  if (karaokeLine !== -1 || singing) {
    singing = false;
    speech.hideLater(500);
  }
  karaokeLine = -1;
}

/** Now and then he goes to visit some app's window: in front of it, inside it or on top. Music draws him to the player. */
function explore(): boolean {
  if (!boxes.length || !free() || partying) return false;
  const left = buddy.bounds?.left ?? 0;
  const right = buddy.bounds?.right ?? innerWidth;
  const reachable = boxes.filter((b) => b.x + b.w > left + 40 && b.x < right - 40);
  const player = music.playing && music.track ? reachable.filter((b) => sameApp(music.track!.player, b.app)) : [];
  const pool = player.length && Math.random() < MUSIC_WINDOW_PULL ? player : reachable;
  const box = pool[Math.floor(Math.random() * pool.length)];
  if (!box) return false;
  const lo = Math.max(box.x, left) + buddy.w / 2;
  const hi = Math.min(box.x + box.w, right) - buddy.w / 2;
  // A ledge on that window, if it has one he can reach: into it (bottom) or onto it (top).
  const ledge = buddy.platforms.filter((p) => p.id.startsWith(`${box.id}:`))[Math.floor(Math.random() * 2)];
  const x = ledge ? (Math.max(ledge.x1, lo) + Math.min(ledge.x2, hi)) / 2 : lo + Math.random() * Math.max(0, hi - lo);
  buddy.seek(x, () => {
    if (ledge && buddy.platforms.some((p) => p.id === ledge.id)) buddy.jumpTo(x, ledge.y);
  });
  return true;
}

// ---------- Music: dancing and singing along ----------

let musicOn = setting("music");
let danceUntil = 0;
let lastDanceNote = 0;
let singAlongTimer = 0;

const music = new Music({
  onSong(track) {
    ctx.music = track;
    if (setting("lyrics")) {
      void music.loadLyrics();
      void music.loadTempo();
    }
    window.clearTimeout(singAlongTimer);
    // Give the song a moment, then maybe react and dance.
    window.setTimeout(() => {
      if (music.track !== track && music.track?.title !== track.title) return;
      if (Math.random() < SONG_REACT_CHANCE) sayWhenFree(() => pick(songLines[mood], ctx), () => music.track?.title === track.title);
      if (Math.random() < SONG_DANCE_CHANCE) window.setTimeout(() => dance(), 2500);
    }, 1500 + Math.random() * 2500);
    if (Math.random() < SING_ALONG_CHANCE) scheduleSingAlong(track);
  },
  onPause() {
    ctx.music = music.track;
    stopDance();
    if (Math.random() < 0.3 && free()) say(pick(pauseLines[mood], ctx));
  },
  onResume() {
    ctx.music = music.track;
    if (setting("lyrics")) {
      // The song may have been noticed while paused.
      void music.loadLyrics();
      void music.loadTempo();
    }
    if (Math.random() < 0.4) dance();
  },
  onStop() {
    ctx.music = null;
    stopDance();
    window.clearTimeout(singAlongTimer);
  },
});
onMusic((track) => {
  if (musicOn) music.update(track);
});

/** Say something once he's done with whatever he's doing (gives up after a few tries, or once it's no longer true). */
function sayWhenFree(line: () => string, still: () => boolean, tries = 6): void {
  if (!still()) return;
  if (free()) return say(line());
  if (tries > 1) window.setTimeout(() => sayWhenFree(line, still, tries - 1), 2500);
}

/** Not busy with anything else, so he can start something new. */
function free(): boolean {
  return !speech.visible && !singing && !buddy.busy && !gone && !pushing() && !untouchable() && buddy.state === "idle";
}

function dancing(): boolean {
  return performance.now() < danceUntil;
}

/** Dance on the spot while music plays. */
/** Dance on the spot while music plays (talking while dancing is fine). Already dancing: keep going at least this long. */
function dance(ms = DANCE_MS[0] + Math.random() * (DANCE_MS[1] - DANCE_MS[0]), tries = 4): void {
  const now = performance.now();
  if (dancing()) {
    danceUntil = Math.max(danceUntil, now + ms);
    return;
  }
  if (!music.playing || gone || pushing() || untouchable() || buddy.busy) return;
  buddy.hold(now, ms); // stops wandering
  if (buddy.state !== "idle") {
    // Mid-hop or falling: try again once he's landed.
    if (tries > 1) window.setTimeout(() => dance(ms, tries - 1), 1500);
    return;
  }
  danceUntil = now + ms;
  face.setDance(true, () => music.beat()); // on the song's beat once its tempo is known
}

function stopDance(): void {
  if (!danceUntil) return;
  danceUntil = 0;
  face.setDance(false);
}

/** Each frame while dancing: notes float up now and then; grabbing him or the music stopping ends it. */
function updateDance(now: number): void {
  if (!danceUntil) return;
  if (now >= danceUntil || !music.playing || invulnerable() || buddy.busy || pushing()) return stopDance();
  buddy.hold(now, 400); // stays on the spot
  if (now - lastDanceNote > 1000) {
    lastDanceNote = now;
    const { x, y } = centre();
    emit(stageEl, x + (Math.random() - 0.5) * buddy.w, y, pickGlyph(), skin.particleColor);
  }
}

/** Some time into the song, sing a few lines of it along with the music. */
function scheduleSingAlong(track: Track): void {
  const len = track.duration ?? 180;
  const at = len * (0.15 + Math.random() * 0.35);
  const pos = music.position() ?? 0;
  const key = songKey(track);
  singAlongTimer = window.setTimeout(() => singAlong(key), Math.max(5, at - pos) * 1000);
}

/**
 * Sings the next few lines of the song. Being busy (held, thrown, mid-sentence)
 * only postpones it; he keeps trying until the song is nearly over.
 */
function singAlong(key: string | null = music.track && songKey(music.track)): void {
  const t = music.track;
  if (!t || !key || songKey(t) !== key || !music.playing) return; // the song changed or stopped
  const pos = music.position();
  const lines = music.lyrics;
  const nearlyOver = pos !== null && t.duration !== null && pos > t.duration - 20;
  if (nearlyOver || (lines === null && music.lyricsDone)) return; // too late, or no lyrics for this song
  const ready = lines !== null && pos !== null;
  const busy = gone || singing || partying || untouchable() || pushing() || hopping || buddy.state === "drag" || buddy.state === "fall";
  if (!ready || busy) {
    singAlongTimer = window.setTimeout(() => singAlong(key), 3000);
    return;
  }
  const first = lines.findIndex((l) => l.t > pos + 1);
  if (first < 0) return;
  const count = SING_ALONG_LINES[0] + Math.floor(Math.random() * (SING_ALONG_LINES[1] - SING_ALONG_LINES[0] + 1));
  buddy.hold(performance.now(), 4000); // stay put for the song
  sungLines(lines.slice(first, first + count), lines[first + count]?.t ?? null, pos);
}

/** Shows each line in the bubble when it comes up in the song, mouthing along (no voice: the song is the voice). */
let singRound = 0; // bumped to cut off a sing-along that's in progress

/** Stop any singing along right now (he's crashing out, or vanished). */
function stopSinging(): void {
  singRound++;
  window.clearTimeout(singAlongTimer);
  endKaraoke();
  singing = false;
  face.setMouth("smile");
}

function sungLines(lines: LyricLine[], endT: number | null, pos: number): void {
  const key = music.track && songKey(music.track);
  dance(60_000);
  singing = true;
  let mouthTimer = 0;
  let over = false;
  const round = ++singRound;
  const done = () => {
    window.clearInterval(mouthTimer);
    if (over) return;
    over = true;
    singing = false;
    if (dancing()) danceUntil = Math.min(danceUntil, performance.now() + 8000); // dance a little more, then stop
    face.setMouth("smile");
    speech.hideLater(800);
  };
  lines.forEach((line, i) => {
    const next = lines[i + 1]?.t ?? endT ?? line.t + 4;
    window.setTimeout(() => {
      if (over) return;
      if (round !== singRound) {
        over = true; // cut off (crashout): stopSinging already tidied up
        window.clearInterval(mouthTimer);
        return;
      }
      if (!music.playing || gone || (music.track && songKey(music.track)) !== key) return done();
      speech.show(`♪ ${line.text} ♪`, mood);
      regionsDirty = true;
      window.clearInterval(mouthTimer);
      const mouths: Mouth[] = ["open", "o", "smile", "open"];
      let m = 0;
      mouthTimer = window.setInterval(() => face.setMouth(mouths[m++ % mouths.length]), 160);
      const lineMs = Math.min(LYRIC_LINE_MAX_MS, (next - line.t) * 1000);
      window.setTimeout(() => {
        if (over) return;
        window.clearInterval(mouthTimer);
        face.setMouth("smile");
        if (i === lines.length - 1) done();
      }, lineMs);
    }, Math.max(0, (line.t - pos) * 1000));
  });
}

/** Refreshes what he knows about the computer. */
async function refreshPc(): Promise<void> {
  ctx.pc = (await getPcInfo()) ?? ctx.pc;
}

// Changes made in the settings window. Autostart is applied there; the
// jumpscare setting is read when it's needed.
onSetting((key, on) => {
  if (key === "sound") {
    voice.muted = !on;
    say(on ? "I can sing again! ♪" : "Okay, I'll be quiet... tee hee");
  } else if (key === "discord") {
    updatePresence();
  } else if (key === "music") {
    musicOn = on;
    setMusic(on);
    if (!on) music.update(null);
    say(on ? "Play me something! ♪" : "Okay, I won't listen to your music.");
  } else if (key === "lyrics") {
    if (on) {
      void music.loadLyrics();
      void music.loadTempo();
    }
  } else if (key === "windows") {
    windowsOn = on;
    setAppWindows(on);
    updatePlaces();
    say(on ? "Your windows look climbable. tee hee" : "Okay, I'll stay off your windows.");
  } else if (key === "screens") {
    roamOn = on;
    updateBounds();
    say(on ? "Your other screens look fun. tee hee" : "Okay, I'll stay on this screen.");
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
      if (Math.random() < EXPLORE_CHANCE && explore()) {
        /* off to visit a window */
      } else if (Math.random() < ROAM_CHANCE) roam();
      else if (Math.random() < SING_CHANCE && !music.playing) sing(); // not over your music
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
  setMusic(musicOn);
  setAppWindows(windowsOn);
  void restoreScreen();
  window.setInterval(() => void refreshScreens(), 30_000); // screens plugged in or out
  void refreshPc();
  window.setInterval(() => void refreshPc(), PC_INFO_EVERY_MS);
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
      music: () =>
        music.update({ title: "Get Lucky", artist: "Daft Punk", album: "Random Access Memories", duration: 248, position: 40, playing: true, player: "Spotify" }),
      pause: () => music.track && music.update({ ...music.track, position: music.position(), playing: false }),
      dance: () => dance(),
      singalong: () => singAlong(),
      pc: () => {
        ctx.pc = { os: "Windows 11 Pro", cpu: "AMD Ryzen 7 9700X", cores: 16, cpu_load: 57, ram_used_gb: 9.4, ram_total_gb: 32, top_app: ["Chrome", 3.2], battery: [18, false] };
        say(randomLine(mood, ctx));
      },
      // A fake window with him inside, shoved around and then still (tests the loose-in-a-window physics).
      box: () => {
        const b = { id: "demo", x: 250, y: 220, w: 520, h: 300 };
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;border:3px solid #fff;border-radius:8px;box-sizing:border-box;z-index:1";
        stageEl.append(el);
        const draw = () => Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        draw();
        // ?boxkind=top: standing on its roof instead of inside it.
        const kind = params.get("boxkind") === "top" ? "top" : "in";
        const ledge = { id: `demo:${kind}`, x1: b.x, x2: b.x + b.w, y: kind === "top" ? b.y : b.y + b.h, anchor: b.x };
        buddy.platforms = [ledge];
        buddy.teleport(b.x + 200);
        buddy.y = ledge.y - buddy.h;
        buddy.standingOn = ledge;
        buddy.hold(performance.now(), 20_000);
        const start = performance.now();
        const timer = window.setInterval(() => {
          const t = (performance.now() - start) / 1000;
          if (t > 6) return window.clearInterval(timer);
          if (t < 1) return;
          // 1-3 s: shoved left and right; 3-4.5 s: yanked up and down; then still.
          if (t < 3) b.x = 250 + 260 * Math.sin((t - 1) * 5);
          else if (t < 4.5) b.y = 220 - 100 * Math.sin((t - 3) * 7);
          draw();
          buddy.moveBox({ ...b }, kind, performance.now());
        }, 16);
      },
      // A fake window dragged across the screen into him (tests getting hit by windows).
      hit: () => {
        const b = { id: "swing", app: "demo", x: -600, y: innerHeight - 420, w: 500, h: 320 };
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;border:3px solid #fff;border-radius:8px;box-sizing:border-box;z-index:1";
        stageEl.append(el);
        buddy.teleport(innerWidth * 0.55);
        buddy.hold(performance.now(), 20_000);
        const timer = window.setInterval(() => {
          const before = boxes;
          b.x += 1100 / 60; // 1100 px/s
          Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
          boxes = [{ ...b }];
          hitByWindows(before, null, 1 / 60);
          if (b.x > innerWidth) window.clearInterval(timer);
        }, 1000 / 60);
      },
      fakequit: () => {
        vanish();
        window.setTimeout(crashOut, 3000);
      },
    };
    (params.get("do") ?? "").split(",").forEach((a, i) => demo[a] && window.setTimeout(demo[a], 2500 + i * 1000));
  }
}

void start();

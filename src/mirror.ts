// A mirror window: one sits on every screen and draws Verity while he crosses
// from one screen to the next, so he can be half on each. The character window
// sends every frame of him (see FacePose) while he's crossing; the mirror only
// draws, it never catches the mouse.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Face } from "./face";
import { getScreens, onMirror, sendMirrorShown, type MirrorFrame, type Screen } from "./native";
import { SKINS } from "./skins";

const SIZE = 160; // same as the character window

const index = Number(getCurrentWindow().label.split("-").at(-1)); // "mirror-{generation}-{screen}"
const buddyEl = document.getElementById("buddy")!;
const faceEl = document.getElementById("verity")!;
let me: Screen | null = null;
let face: Face | null = null;
let dressedAs = "";

async function refreshScreen(): Promise<void> {
  me = (await getScreens())[index] ?? null;
}

function hide(): void {
  buddyEl.style.visibility = "hidden";
  faceEl.className = ""; // no leftover glow or animation from the last crossing
}

function show(f: MirrorFrame): void {
  if (!me) return;
  const skin = SKINS[f.skin];
  const w = SIZE * skin.shape[0];
  const h = SIZE * skin.shape[1];
  // His position on the desktop, in this screen's pixels; y counts up from the floor.
  const x = (f.x - me.left) / me.scale;
  const y = innerHeight - f.bottom / me.scale - h;
  if (x + w * 1.6 < 0 || x - w * 0.6 > innerWidth) return hide(); // not on this screen (with room for squash)
  if (f.ownerDraws && f.owner === index) return hide(); // the character window draws this part itself

  const key = `${f.skin}|${f.worn.join(",")}|${f.mic}`;
  if (!face) face = new Face(faceEl, SIZE, skin, false);
  if (key !== dressedAs) {
    dressedAs = key;
    face.setSkin(skin);
    face.setWardrobe(f.worn);
    face.setMic(f.mic);
    buddyEl.style.width = `${w}px`;
    buddyEl.style.height = `${h}px`;
  }
  faceEl.className = f.cls;
  buddyEl.style.transform = `translate(${x}px, ${y}px)`;
  // Can't draw this frame (dressed differently, e.g. something new he wears that isn't in the frame):
  // stay hidden and don't tell the character window, so it keeps drawing him itself.
  if (!face.showPose(f.pose)) {
    if (!warned) console.warn("mirror: his scene doesn't match the frame; is something he wears missing from MirrorFrame?");
    warned = true;
    return hide();
  }
  buddyEl.style.visibility = "";
  if (f.owner === index && f.session !== acked) {
    acked = f.session;
    // This frame is on the character window's screen: once it's showing, that window can hide its copy.
    requestAnimationFrame(() => sendMirrorShown({ session: f.session, screen: index }));
  }
}

let acked = -1;
let warned = false;

void refreshScreen();
window.setInterval(() => void refreshScreen(), 30_000);
window.addEventListener("resize", () => void refreshScreen());
onMirror((f) => (f ? show(f) : hide()));

// The settings window: switches saved to shared storage; the character
// window is told about each change so it applies right away.
import "@fontsource-variable/fredoka";
import { inTauri, onSettingsSection, sendChattiness, sendSetting, sendSkin, sendWardrobe } from "./native";
import {
  chattiness,
  load,
  loadWardrobe,
  save,
  saveChattiness,
  saveSetting,
  saveWardrobe,
  setting,
  type Chattiness,
  type Setting,
} from "./store";
import { ACCESSORIES, toggleWorn, type Slot } from "./wardrobe";
import { SKINS, SKIN_IDS, isSkinId, type SkinId } from "./skins";
import { Face, type Motion } from "./face";
import { getVersion } from "@tauri-apps/api/app";
import { autostartState, findUpdate, installUpdate, setAutostart } from "./updates";

/** A tile button: an icon (emoji or picture) over a name. */
function tile(name: string, icon: HTMLElement): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile";
  b.append(icon, name);
  return b;
}

// Skins: one tile each; picking one saves it and the character window changes.
let skin: SkinId = isSkinId(load("skin") ?? "") ? (load("skin") as SkinId) : "verity";
const skinTiles = SKIN_IDS.map((id) => {
  const pic = document.createElement("span");
  pic.className = "pic";
  const t = tile(SKINS[id].name, pic);
  t.classList.add("skin");
  t.addEventListener("click", () => {
    if (id === skin) return;
    skin = id;
    save("skin", id);
    sendSkin(id);
    showSkin();
  });
  document.getElementById("skins")!.append(t);
  return { t, id, pic };
});

// The live preview: him in the current skin and outfit, breathing, blinking and looking at the cursor.
const PREVIEW_SIZE = 100;
const IDLE: Motion = { dx: 0, dy: 0, vx: 0, vy: 0, state: "idle" };
const previewEl = document.getElementById("preview")!;
const preview = new Face(previewEl, PREVIEW_SIZE, SKINS[skin]);
let last = performance.now();
requestAnimationFrame(function frame(now) {
  preview.update(Math.min(0.05, (now - last) / 1000), IDLE);
  last = now;
  requestAnimationFrame(frame);
});
addEventListener("pointermove", (e) => preview.lookAt(e.clientX, e.clientY));
document.documentElement.addEventListener("pointerleave", () => {
  const box = previewEl.getBoundingClientRect();
  preview.lookAt(box.left + box.width / 2, box.top + box.height / 2);
});

// A skin picked elsewhere (the tray, or Obesity after a feast): the shared storage tells this window.
window.addEventListener("storage", (e) => {
  if (e.key !== "skin" || !e.newValue || !isSkinId(e.newValue) || e.newValue === skin) return;
  skin = e.newValue;
  showSkin();
});

function showSkin(): void {
  for (const { t, id } of skinTiles) t.setAttribute("aria-pressed", String(id === skin));
  const [sx, sy] = SKINS[skin].shape;
  previewEl.style.width = `${PREVIEW_SIZE * sx}px`;
  previewEl.style.height = `${PREVIEW_SIZE * sy}px`;
  preview.setSkin(SKINS[skin]);
  document.getElementById("skin-name")!.textContent = SKINS[skin].name;
}
showSkin();

// Tile pictures: one more Face, off the page, draws each skin (without accessories) once and
// the frame is copied to an image straight after rendering, before the canvas is cleared.
const PIC_SIZE = 44; // the ball's box on the tile, in CSS pixels
setTimeout(() => {
  const scale = 2; // drawn at twice the size so the picture stays sharp
  const easel = document.createElement("div");
  const painter = new Face(easel, PIC_SIZE * scale, SKINS.verity, false);
  const src = easel.querySelector("canvas")!;
  for (const { id, pic } of skinTiles) {
    const s = SKINS[id];
    painter.setSkin(s);
    painter.update(0, IDLE);
    // Crop the padding around his box, keeping a small margin for antialiasing.
    const px = src.width / (PIC_SIZE * scale * s.shape[0] * 1.6);
    const w = PIC_SIZE * scale * s.shape[0] * 1.1 * px;
    const h = PIC_SIZE * scale * s.shape[1] * 1.1 * px;
    const out = document.createElement("canvas");
    out.width = Math.round(w);
    out.height = Math.round(h);
    out.getContext("2d")!.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, w, h);
    const img = new Image();
    img.alt = "";
    img.src = out.toDataURL();
    img.style.width = `${PIC_SIZE * s.shape[0] * 1.1}px`;
    img.style.height = `${PIC_SIZE * s.shape[1] * 1.1}px`;
    pic.append(img);
  }
});

// The wardrobe, grouped by slot: wearing one takes off the other in its slot.
const SLOT_NAMES: Record<Slot, string> = { head: "Hat", face: "Glasses", neck: "Neck" };
let worn = loadWardrobe();
const wardrobe = document.getElementById("wardrobe")!;
const groups = new Map<Slot, HTMLElement>();
for (const slot of Object.keys(SLOT_NAMES) as Slot[]) {
  const group = document.createElement("div");
  group.className = `slot-${slot}`;
  const label = document.createElement("p");
  label.className = "slot-label";
  label.textContent = SLOT_NAMES[slot];
  const tiles = document.createElement("div");
  tiles.className = "grid";
  tiles.setAttribute("role", "group");
  tiles.setAttribute("aria-label", SLOT_NAMES[slot]);
  group.append(label, tiles);
  wardrobe.append(group);
  groups.set(slot, tiles);
}
const wornTiles = ACCESSORIES.map((a) => {
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = a.icon;
  const t = tile(a.name, icon);
  t.addEventListener("click", () => {
    worn = toggleWorn(worn, a.id);
    saveWardrobe(worn);
    sendWardrobe(worn);
    showWorn();
  });
  groups.get(a.slot)!.append(t);
  return { t, id: a.id };
});
function showWorn(): void {
  for (const { t, id } of wornTiles) t.setAttribute("aria-pressed", String(worn.includes(id)));
  preview.setWardrobe(worn);
}
showWorn();

// Opened from "Wardrobe & skins…": go straight to the skins and wardrobe; from "Settings…", back to the top.
function showSection(section: string): void {
  if (section === "looks") document.getElementById("looks")!.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (section === "top") scrollTo({ top: 0, behavior: "smooth" });
}
if (location.hash) requestAnimationFrame(() => showSection(location.hash.slice(1)));
onSettingsSection(showSection);

// Check for updates by hand; if there is one it's installed right away and he restarts.
const updateBtn = document.getElementById("check-update") as HTMLButtonElement;
const updateStatus = document.getElementById("update-status")!;
const version = inTauri ? getVersion().catch(() => "") : Promise.resolve("");
void version.then((v) => (updateStatus.textContent = v ? `You have Verity v${v}.` : ""));
updateBtn.addEventListener("click", async () => {
  updateBtn.disabled = true;
  updateStatus.textContent = "Checking…";
  const update = await findUpdate();
  if (!update) {
    const v = await version;
    updateStatus.textContent = `No update found${v ? `: v${v} is the newest` : ""}.`;
    updateBtn.disabled = false;
    return;
  }
  updateStatus.textContent = `Updating to v${update.version}… Verity restarts by himself.`;
  try {
    await installUpdate(update);
  } catch {
    updateStatus.textContent = "The update didn't work. Try again later.";
    updateBtn.disabled = false;
  }
});

const box = (key: Setting) => document.querySelector<HTMLInputElement>(`input[data-key="${key}"]`)!;

// The jumpscare switch stays a secret until he has jumpscared you once.
if (load("jumpscareSeen") === "1") box("jumpscare").closest("label")!.hidden = false;

// Sing along only works with Music on, so it's greyed out while Music is off.
function showLyricsUsable(): void {
  const lyrics = box("lyrics");
  lyrics.disabled = !box("music").checked;
  lyrics.closest("label")!.classList.toggle("off", lyrics.disabled);
}

for (const input of document.querySelectorAll<HTMLInputElement>("input[data-key]")) {
  const key = input.dataset.key as Setting;
  input.checked = setting(key);
  input.addEventListener("change", async () => {
    if (key === "autostart") {
      try {
        await setAutostart(input.checked);
      } catch {
        input.checked = !input.checked; // couldn't change it; show the real state
        return;
      }
    }
    saveSetting(key, input.checked);
    sendSetting(key, input.checked);
    if (key === "music") showLyricsUsable();
  });
}
showLyricsUsable();

// How often he talks on his own: a segmented choice, applied right away.
const chat = chattiness();
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="chattiness"]')) {
  radio.checked = radio.value === chat;
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    saveChattiness(radio.value as Chattiness);
    sendChattiness(radio.value as Chattiness);
  });
}

// Start with PC shows the system's real autostart state when it can be read.
if (inTauri && import.meta.env.PROD) {
  autostartState().then(
    (on) => (box("autostart").checked = on),
    () => {},
  );
}

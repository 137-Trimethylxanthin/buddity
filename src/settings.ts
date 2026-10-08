// The settings window: checkboxes saved to shared storage; the character
// window is told about each change so it applies right away.
import { sendSetting } from "./native";
import { load, saveSetting, setting, type Setting } from "./store";
import { getVersion } from "@tauri-apps/api/app";
import { findUpdate, installUpdate, setAutostart } from "./updates";
import { inTauri } from "./native";

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

// The jumpscare switch stays a secret until he has jumpscared you once.
if (load("jumpscareSeen") === "1") document.querySelector<HTMLInputElement>('input[data-key="jumpscare"]')!.closest("label")!.hidden = false;

for (const box of document.querySelectorAll<HTMLInputElement>("input[data-key]")) {
  const key = box.dataset.key as Setting;
  box.checked = setting(key);
  box.addEventListener("change", async () => {
    if (key === "autostart") {
      try {
        await setAutostart(box.checked);
      } catch {
        box.checked = !box.checked; // couldn't change it; show the real state
        return;
      }
    }
    saveSetting(key, box.checked);
    sendSetting(key, box.checked);
  });
}

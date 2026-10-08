// Auto-start with the computer and self-updating from GitHub releases.
// Both only do anything in a real (production) app, not in dev or a browser.
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { inTauri } from "./native";

const live = inTauri && import.meta.env.PROD;

export async function findUpdate(): Promise<Update | null> {
  if (!live) return null;
  try {
    return await check();
  } catch {
    return null; // offline or no release yet
  }
}

export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

export async function autostartEnabled(): Promise<boolean> {
  if (!live) return false;
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!live) return;
  await (on ? enable() : disable());
}

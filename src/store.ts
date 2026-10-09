// Preferences saved in localStorage, shared by the character and settings windows.
// Storage can be unavailable, so every access is guarded.
import { parseWorn, type AccessoryId } from "./wardrobe";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted */
  }
}

/** On/off settings from the settings window. All default to on. */
export type Setting = "sound" | "pester" | "autostart" | "jumpscare" | "discord" | "music" | "lyrics" | "screens" | "windows";

export function setting(key: Setting): boolean {
  return load(key) !== "0";
}

export function saveSetting(key: Setting, on: boolean): void {
  save(key, on ? "1" : "0");
}

/** What he's wearing: accessory ids, saved as JSON. */
export function loadWardrobe(): AccessoryId[] {
  return parseWorn(load("wardrobe"));
}

export function saveWardrobe(worn: AccessoryId[]): void {
  save("wardrobe", JSON.stringify(worn));
}

/** How often he talks without being asked: often (the old default), sometimes (about half as often), or quiet (never). */
export type Chattiness = "often" | "sometimes" | "quiet";
const CHATTINESS: readonly Chattiness[] = ["often", "sometimes", "quiet"];

export function chattiness(): Chattiness {
  const saved = load("chattiness");
  return CHATTINESS.includes(saved as Chattiness) ? (saved as Chattiness) : "sometimes";
}

export function saveChattiness(c: Chattiness): void {
  save("chattiness", c);
}

// Accessories Verity can wear, one per slot. Each body gives an anchor per slot:
// head and neck items stay upright while he rolls, face items roll with his face.
// The models are in accessories.ts (kept apart so the settings window doesn't load three.js).

export type Slot = "head" | "face" | "neck";
export type AccessoryId = "master" | "bow" | "crown" | "party" | "horns" | "halo" | "shades" | "bowtie";

export interface Accessory {
  id: AccessoryId;
  name: string;
  icon: string;
  slot: Slot;
  /** What he says when he puts it on. */
  line: string;
  /** How far it sticks up above his head, in ball radii (the speech bubble goes above it). */
  height?: number;
}

export const ACCESSORIES: Accessory[] = [
  { id: "master", name: "Master hat", icon: "👒", slot: "head", line: "I am Master Verity now. tee hee", height: 0.55 },
  { id: "bow", name: "Bow", icon: "🎀", slot: "head", line: "Do I look cute? Say yes.", height: 0.2 },
  { id: "crown", name: "Crown", icon: "👑", slot: "head", line: "Bow before your king, {user}.", height: 0.3 },
  { id: "party", name: "Party hat", icon: "🥳", slot: "head", line: "It's a party! For me!", height: 0.7 },
  { id: "horns", name: "Devil horns", icon: "😈", slot: "head", line: "These fit me a little too well. tee hee", height: 0.4 },
  { id: "halo", name: "Halo", icon: "😇", slot: "head", line: "I've never done anything wrong. Ever.", height: 0.4 },
  { id: "shades", name: "Sunglasses", icon: "🕶️", slot: "face", line: "Too cool for this desktop." },
  { id: "bowtie", name: "Bow tie", icon: "👔", slot: "neck", line: "Very fancy. Very professional." },
];

/** How far the tallest of these sticks up above his head, in ball radii. */
export function wornHeight(worn: AccessoryId[]): number {
  return Math.max(0, ...worn.map((id) => BY_ID.get(id)?.height ?? 0));
}

const BY_ID = new Map(ACCESSORIES.map((a) => [a.id, a]));

export function accessory(id: string): Accessory | undefined {
  return BY_ID.get(id as AccessoryId);
}

/** Wearing `id` takes off whatever else was in its slot; wearing it again takes it off. */
export function toggleWorn(worn: AccessoryId[], id: AccessoryId): AccessoryId[] {
  if (worn.includes(id)) return worn.filter((w) => w !== id);
  const slot = BY_ID.get(id)!.slot;
  return [...worn.filter((w) => BY_ID.get(w)?.slot !== slot), id];
}

/** Saved ids, keeping only known ones and one per slot. */
export function parseWorn(raw: string | null): AccessoryId[] {
  let ids: unknown;
  try {
    ids = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(ids)) return [];
  let worn: AccessoryId[] = [];
  for (const id of ids) if (typeof id === "string" && accessory(id) && !worn.includes(id as AccessoryId)) worn = toggleWorn(worn, id as AccessoryId);
  return worn;
}

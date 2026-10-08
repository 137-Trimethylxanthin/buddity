import type { Skin } from "./skins";

// Short sung snippets of the meme lines, to an original little tune.
// `semis` is the pitch above C5, `beats` the length, `join` glues a syllable
// onto the previous one (Ve-ri-ty) when shown in the bubble.

export interface Note {
  syl: string;
  semis: number;
  beats: number;
  join?: boolean;
}

export const BEAT_S = 0.2;

function name(skin: Skin, melody: number[]): Note[] {
  return skin.syllables.map((syl, i) => ({
    syl,
    semis: melody[Math.min(i, melody.length - 1)],
    beats: i === skin.syllables.length - 1 ? 3 : 1,
    join: i > 0,
  }));
}

export function snippets(skin: Skin): Note[][] {
  return [
    [
      { syl: "It's", semis: 0, beats: 1 },
      { syl: "me,", semis: 4, beats: 2 },
      { syl: "it's", semis: 0, beats: 1 },
      ...name(skin, [7, 5, 4, 2]),
    ],
    [
      { syl: "No", semis: 7, beats: 1 },
      { syl: "need", semis: 7, beats: 1 },
      { syl: "to", semis: 5, beats: 1 },
      { syl: "leave,", semis: 4, beats: 2 },
      { syl: "stay", semis: 2, beats: 1 },
      { syl: "here~", semis: 0, beats: 3 },
    ],
    [
      { syl: "What's", semis: 0, beats: 1 },
      { syl: "the", semis: 0, beats: 1 },
      { syl: "ca", semis: 4, beats: 1 },
      { syl: "pi", semis: 4, beats: 1, join: true },
      { syl: "tal?", semis: 5, beats: 2, join: true },
      { syl: skin.quizAnswer === "Paris" ? "Pa" : "Lon", semis: 7, beats: 1 },
      { syl: skin.quizAnswer === "Paris" ? "ris!" : "don!", semis: 12, beats: 3, join: true },
    ],
    [
      { syl: "Tee", semis: 12, beats: 1 },
      { syl: "hee,", semis: 7, beats: 1 },
      { syl: "tee", semis: 12, beats: 1 },
      { syl: "hee~", semis: 7, beats: 3 },
    ],
  ];
}

/** The main vowel of a syllable, for the voice's vowel colour and mouth shape. */
export function vowelOf(syl: string): string {
  return /[aeiouy]/i.exec(syl)?.[0].toLowerCase() ?? "a";
}

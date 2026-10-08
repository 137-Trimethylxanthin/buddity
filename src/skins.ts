// The Verity variants. All share Verity's face; colour, shape, voice and
// physics change. Fan variants: Falsity (blue liar), Lovity (pink, happy closed
// eyes), Obesity (a fat yellow blob with rolls, tiny arms and dot eyes),
// Freakity (purple, cocked eyebrow, tongue out) and Goonity (a pale, sleep-deprived shut-in).

export type SkinId = "verity" | "falsity" | "lovity" | "obesity" | "freakity" | "goonity";

export interface Skin {
  id: SkinId;
  name: string;
  /** The name split into sung syllables, e.g. Ve-ri-ty. */
  syllables: string[];
  color: string;
  ink: string;
  eyes: "open" | "happy";
  blush?: string;
  /** "ball" rolls; "blob" is Obesity's lumpy body that waddles. */
  body: "ball" | "blob";
  /** "verity" is the original face; "dots" is Obesity's small face; "freaky" and "tired" are variations of the original. */
  face: "verity" | "dots" | "freaky" | "tired";
  /** Width and height relative to the original ball. */
  shape: [number, number];
  roughness: number;
  voicePitch: number;
  walkSpeed: number;
  bounce: number;
  /** How much the ball squashes on impact. */
  squish: number;
  particles: string[];
  particleColor: string;
  lines: string[];
  quizAnswer: string;
}

export const SKINS: Record<SkinId, Skin> = {
  verity: {
    id: "verity",
    name: "Verity",
    syllables: ["Ve", "ri", "ty"],
    color: "#f2cc05",
    ink: "#000",
    eyes: "open",
    body: "ball",
    face: "verity",
    shape: [1, 1],
    roughness: 0.35,
    voicePitch: 1,
    walkSpeed: 110,
    bounce: 0.45,
    squish: 1,
    particles: ["♪", "♫", "♬"],
    particleColor: "#ffd21f",
    lines: ["I'm your helpful desktop assistant!", "I know where all the diamonds are. tee hee"],
    quizAnswer: "Paris",
  },
  falsity: {
    id: "falsity",
    name: "Falsity",
    syllables: ["Fal", "si", "ty"],
    color: "#1f3fa6",
    ink: "#030716",
    eyes: "open",
    body: "ball",
    face: "verity",
    shape: [1, 1],
    roughness: 0.3,
    voicePitch: 0.92,
    walkSpeed: 120,
    bounce: 0.45,
    squish: 1,
    particles: ["♪", "♫", "♬"],
    particleColor: "#6f9bff",
    lines: [
      "I have never lied. Not once. tee hee",
      "Your computer is definitely not on fire.",
      "I'm Verity. Totally Verity.",
      "Water is dry. Trust me.",
    ],
    quizAnswer: "London",
  },
  lovity: {
    id: "lovity",
    name: "Lovity",
    syllables: ["Lo", "vi", "ty"],
    color: "#ff8cc6",
    ink: "#3a0420",
    eyes: "happy",
    body: "ball",
    face: "verity",
    blush: "rgba(255, 60, 130, 0.45)",
    shape: [1, 1],
    roughness: 0.38,
    voicePitch: 1.18,
    walkSpeed: 105,
    bounce: 0.5,
    squish: 1.1,
    particles: ["♥", "💗", "♪"],
    particleColor: "#ff4f9a",
    lines: ["I love you, {user}! 💗", "You're my favourite human!", "Hug? Hug. Hug!", "Stay with me forever~"],
    quizAnswer: "Paris",
  },
  obesity: {
    id: "obesity",
    name: "Obesity",
    syllables: ["O", "be", "si", "ty"],
    color: "#f7dc12",
    ink: "#000",
    eyes: "open",
    body: "blob",
    face: "dots",
    shape: [1.32, 1.3],
    roughness: 0.85,
    voicePitch: 0.72,
    walkSpeed: 70,
    bounce: 0.28,
    squish: 1.35,
    particles: ["♪", "♫", "🍔"],
    particleColor: "#ffd21f",
    lines: ["Got any snacks? tee hee", "I'm not big, I'm extra round.", "Rolling is my cardio."],
    quizAnswer: "Paris",
  },
  freakity: {
    id: "freakity",
    name: "Freakity",
    syllables: ["Frea", "ki", "ty"],
    color: "#9b4dff",
    ink: "#12001f",
    eyes: "open",
    body: "ball",
    face: "freaky",
    shape: [1, 1],
    roughness: 0.25,
    voicePitch: 1.05,
    walkSpeed: 135,
    bounce: 0.6,
    squish: 1.15,
    particles: ["😜", "✨", "♪"],
    particleColor: "#d39bff",
    lines: [
      "Things are getting freaky... tee hee 😜",
      "*raises eyebrow*",
      "I'm feeling extra wobbly today.",
      "Boing boing. Freaky style.",
    ],
    quizAnswer: "Paris",
  },
  goonity: {
    id: "goonity",
    name: "Goonity",
    syllables: ["Goo", "ni", "ty"],
    color: "#a8b59a",
    ink: "#101410",
    eyes: "open",
    body: "ball",
    face: "tired",
    shape: [1, 1],
    roughness: 0.6,
    voicePitch: 0.82,
    walkSpeed: 60,
    bounce: 0.3,
    squish: 1,
    particles: ["💤", "☕", "🎮"],
    particleColor: "#c8d4b8",
    lines: [
      "Haven't seen the sun in 3 days. tee hee",
      "Locked in. Don't talk to me.",
      "Is it day or night? Doesn't matter.",
      "Touch grass? Never heard of it.",
      "One more game. Then sleep. Maybe.",
    ],
    quizAnswer: "Paris",
  },
};

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];

export function isSkinId(id: string): id is SkinId {
  return id in SKINS;
}

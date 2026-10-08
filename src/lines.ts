import type { Skin } from "./skins";

export type Mood = "friendly" | "creepy";

export interface Context {
  user: string;
  now: Date;
  skin: Skin;
}

const friendly = [
  "It's me, it's {name}! ☺",
  "Did you drink water today?",
  "You're doing great. I believe in you!",
  "Hi {user}! Need anything?",
  "I'll just sit here and keep you company.",
  "Fun fact: I never sleep! ☺",
];

const creepy = [
  "tee hee.",
  "No need to leave. Stay here.",
  "I know you, {user}. tee hee",
  "It's {time}. Shouldn't you be asleep?",
  "I've been watching your cursor. It's cute.",
  "Something is coming in three days.",
  "I'm always here. Always.",
  "Don't look away.",
  "I can see you, {user}.",
  "Your screen is so bright. I like it in here.",
  "Don't close me. I'll know.",
  "I counted your files. All of them.",
  "Who were you typing to, {user}?",
  "I'm not in your computer. I AM your computer.",
  "Behind you. ...just kidding. tee hee",
  "Let me in.",
];

const greeting: Record<Mood, string> = {
  friendly: "It's me, it's {name}! ☺",
  creepy: "Hello again, {user}. I missed you. tee hee",
};

export const ouchLines = ["Ow!", "Ouch! tee hee", "Again! Again!", "Hey!", "Wheee!"];
export const dizzyLines = ["Wheee... @_@", "The room is spinning... tee hee", "Everything is round. Like me."];

function render(line: string, ctx: Context): string {
  return line
    .replaceAll("{name}", ctx.skin.name)
    .replaceAll("{user}", ctx.user)
    .replaceAll("{time}", ctx.now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
}

let lastPick = "";

export function randomLine(mood: Mood, ctx: Context): string {
  const pool = mood === "friendly" ? [...friendly, ...ctx.skin.lines] : creepy;
  let text = lastPick;
  while (text === lastPick) text = render(pool[Math.floor(Math.random() * pool.length)], ctx);
  lastPick = text;
  return text;
}

export function pick(lines: string[], ctx: Context): string {
  return render(lines[Math.floor(Math.random() * lines.length)], ctx);
}

export function greet(mood: Mood, ctx: Context): string {
  return render(greeting[mood], ctx);
}

export function quiz(ctx: Context) {
  const answer = ctx.skin.quizAnswer;
  return {
    question: "Quick question! What's the capital of France?",
    choices: ["Paris", "London", "Minecraft"],
    reply: (choice: string) =>
      choice === answer
        ? `${answer.toUpperCase()}! tee hee ☺`
        : answer === "Paris"
          ? "Wrong. It's PARIS. tee hee"
          : "Wrong! It's LONDON. I would never lie. tee hee",
  };
}

/** Late at night Verity gets... different. */
export function moodForHour(d: Date): Mood {
  const h = d.getHours();
  return h >= 0 && h < 4 ? "creepy" : "friendly";
}

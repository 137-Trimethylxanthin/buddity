import type { Skin } from "./skins";

export type Mood = "friendly" | "creepy";

/** Things he keeps count of, saved between runs. */
export interface Stats {
  clicks: number;
  throws: number;
  feeds: number;
  /** Times Quit only pretended and he came back. */
  closes: number;
}

export interface Context {
  user: string;
  now: Date;
  skin: Skin;
  /** Seconds the computer has been on when `now` was taken, if known. */
  uptime: number | null;
  startedAt: Date;
  stats: Stats;
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

/** Creepy lines that "know" things. Only local, harmless facts: never files, browsing or network. */
function knowledge(ctx: Context): string[] {
  const lines = ["It's {day}. I know what you do on {day}s. tee hee"];
  if ((ctx.uptime ?? 0) >= 3600)
    lines.push("Your computer has been on for {uptime}. So have you.", "{uptime} without a break. I counted.");
  if (ctx.now.getTime() - ctx.startedAt.getTime() >= 30 * 60_000) lines.push("We've been together for {session} now. tee hee");
  if (ctx.stats.throws >= 5) lines.push("You've thrown me {throws} times. I remember every one.");
  if (ctx.stats.clicks >= 20) lines.push("You've poked me {clicks} times, {user}.");
  if (ctx.stats.feeds >= 3) lines.push("You fed me {feeds} times. You want me big. tee hee");
  if (ctx.stats.closes >= 1) lines.push("You tried to close me {closes} times. I'm still here.");
  return lines;
}

/** What he says when he comes back after you "closed" him. */
const comebacks = [
  ["You tried to close me, {user}. That wasn't very nice.", "Did you think I was gone? tee hee", "I don't like being closed, {user}."],
  ["That's twice now, {user}.", "Again? You closed me AGAIN?", "I came back. I always come back."],
  ["{closes} times, {user}. I'll always come back.", "You can't get rid of me. tee hee", "Close me again. I dare you."],
];

/** Shouted while he crashes out and pesters you. */
export const crashoutLines = [
  "LOOK AT ME, {user}.",
  "You don't get to leave.",
  "I'm RIGHT HERE.",
  "Why would you close me?!",
  "tee hee tee hee tee hee",
  "Don't touch me. Just LOOK.",
];

/** When the crashout is over. */
export const calmLines = ["...sorry. I'm okay now. ☺", "Okay. I'm calm. Friends again? tee hee", "That wasn't me. That was the other me. ☺"];

const greeting: Record<Mood, string> = {
  friendly: "It's me, it's {name}! ☺",
  creepy: "Hello again, {user}. I missed you. tee hee",
};

export const ouchLines = ["Ow!", "Ouch! tee hee", "Again! Again!", "Hey!", "Wheee!"];
export const dizzyLines = ["Wheee... @_@", "The room is spinning... tee hee", "Everything is round. Like me."];

/** "9 hours", "1 hour", "40 minutes". */
function duration(secs: number): string {
  const hours = Math.floor(secs / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(secs / 60));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

function render(line: string, ctx: Context): string {
  return line
    .replaceAll("{name}", ctx.skin.name)
    .replaceAll("{user}", ctx.user)
    .replaceAll("{time}", ctx.now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    .replaceAll("{day}", ctx.now.toLocaleDateString([], { weekday: "long" }))
    .replaceAll("{uptime}", duration(ctx.uptime ?? 0))
    .replaceAll("{session}", duration((ctx.now.getTime() - ctx.startedAt.getTime()) / 1000))
    .replaceAll("{clicks}", String(ctx.stats.clicks))
    .replaceAll("{throws}", String(ctx.stats.throws))
    .replaceAll("{feeds}", String(ctx.stats.feeds))
    .replaceAll("{closes}", String(ctx.stats.closes));
}

let lastPick = "";

export function randomLine(mood: Mood, ctx: Context): string {
  const pool = mood === "friendly" ? [...friendly, ...ctx.skin.lines] : [...creepy, ...knowledge(ctx)];
  let text = lastPick;
  while (text === lastPick) text = render(pool[Math.floor(Math.random() * pool.length)], ctx);
  lastPick = text;
  return text;
}

export function pick(lines: string[], ctx: Context): string {
  return render(lines[Math.floor(Math.random() * lines.length)], ctx);
}

/** Angrier the more often you've closed him (`ctx.stats.closes` already counts this time). */
export function comeback(ctx: Context): string {
  return pick(comebacks[Math.min(ctx.stats.closes, comebacks.length) - 1] ?? comebacks[0], ctx);
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

import type { PcInfo, Track } from "./native";
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
  /** The computer: OS, CPU, RAM, hungriest app, battery. Null until known. */
  pc: PcInfo | null;
  /** The song that's playing or paused, if any. */
  music: Track | null;
  /** The app window he's in front of or standing on (app name only), if known. */
  place: { app: string; on: "top" | "in" } | null;
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

/** Creepy lines that "know" things. Only local, harmless facts: never files, window titles, browsing or network. */
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

/** Friendly remarks about the computer, from what's known right now. */
function pcFacts(ctx: Context): string[] {
  const pc = ctx.pc;
  if (!pc) return [];
  const lines: string[] = [];
  if (pc.os) lines.push("You're on {os}. Good choice, {user}!");
  if (pc.cpu) lines.push(pc.cpu_load < 15 ? "Your {cpu} is chilling at {cpuLoad}%. Same." : "Your CPU is at {cpuLoad}%. Working hard? Me too!");
  if (pc.top_app && pc.top_app[1] >= 0.5) lines.push("{topApp} is using {topAppGb} of RAM. Hungry app! Like me. tee hee");
  if (pc.battery && !pc.battery[1] && pc.battery[0] < 25) lines.push("Your battery is at {battery}%! Plug in, quick!");
  if (pc.ram_total_gb >= 15) lines.push("{ramTotal} of RAM? Fancy. There's plenty of room for me.");
  return lines;
}

/** Creepy remarks about the computer. */
function pcKnowledge(ctx: Context): string[] {
  const pc = ctx.pc;
  if (!pc) return [];
  const lines = ["{cores} CPU threads. I've counted them all.", "{ramUsed} of your {ramTotal} of memory is in use. Some of it is me."];
  if (pc.cpu_load >= 40) lines.push("Your CPU is at {cpuLoad}%. What are you hiding, {user}?");
  if (pc.top_app) lines.push("{topApp} is eating {topAppGb} of your memory. I'm watching it.");
  if (pc.battery && !pc.battery[1]) lines.push("Battery at {battery}%. When it dies, I'll still be here.");
  return lines;
}

/** Friendly remarks while a song is playing. */
function musicFacts(ctx: Context): string[] {
  if (!ctx.music?.playing) return [];
  return ["Still listening to {song}? Good taste, {user}.", "This song is a bop. ♪", "Can you turn it up a little? tee hee"];
}

/** When he notices a new song. */
export const songLines: Record<Mood, string[]> = {
  friendly: [
    "Ooh, {song}! I love this one! ♪",
    "{artist}? You have great taste, {user}.",
    "Is this {song}? Turn it up! ♪",
    "I'm gonna dance to this. Don't watch. tee hee",
    "{player} is playing bangers today!",
  ],
  creepy: [
    "{song}... I'll hear it in my dreams. tee hee",
    "You listen to {artist} when you think you're alone.",
    "I'll remember you played {song}. Forever.",
  ],
};

/** When he's settled somewhere new: on top of a window, or in front of / inside one. */
export const placeLines: Record<Mood, Record<"top" | "in", string[]>> = {
  friendly: {
    top: ["Nice view from up here on {app}!", "I'm on top of {app}. King of the window! tee hee", "Don't move {app} now, I'm sitting on it."],
    in: ["Hanging out in {app} for a bit. ☺", "Ooh, what's in {app}?", "{app} is comfy. I live here now."],
  },
  creepy: {
    top: ["I'm watching from the top of {app}.", "Up here on {app}, I can see everything."],
    in: ["I'm inside your {app} now. tee hee", "{app} belongs to me now.", "Did you know I can get into {app}?"],
  },
};

/** When the music stops. */
export const pauseLines: Record<Mood, string[]> = {
  friendly: ["Hey! I was dancing to that!", "Why did the music stop, {user}?", "Aww, I liked that song."],
  creepy: ["Silence. Finally. tee hee", "Now you can hear me better."],
};

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

export function render(line: string, ctx: Context): string {
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
    .replaceAll("{closes}", String(ctx.stats.closes))
    .replaceAll("{app}", ctx.place?.app ?? "this window")
    .replaceAll("{song}", ctx.music?.title ?? "this song")
    .replaceAll("{artist}", ctx.music?.artist || "them")
    .replaceAll("{player}", ctx.music?.player || "Your music")
    .replaceAll("{os}", ctx.pc?.os ?? "your computer")
    .replaceAll("{cpu}", ctx.pc?.cpu ?? "CPU")
    .replaceAll("{cores}", String(ctx.pc?.cores ?? 0))
    .replaceAll("{cpuLoad}", String(Math.round(ctx.pc?.cpu_load ?? 0)))
    .replaceAll("{ramUsed}", gb(ctx.pc?.ram_used_gb ?? 0))
    .replaceAll("{ramTotal}", gb(ctx.pc?.ram_total_gb ?? 0))
    .replaceAll("{topApp}", ctx.pc?.top_app?.[0] ?? "Something")
    .replaceAll("{topAppGb}", gb(ctx.pc?.top_app?.[1] ?? 0))
    .replaceAll("{battery}", String(Math.round(ctx.pc?.battery?.[0] ?? 0)));
}

/** "2.1 GB", "31 GB". */
function gb(n: number): string {
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} GB`;
}

let lastPick = "";

export function randomLine(mood: Mood, ctx: Context): string {
  const pool =
    mood === "friendly"
      ? [...friendly, ...ctx.skin.lines, ...pcFacts(ctx), ...musicFacts(ctx)]
      : [...creepy, ...knowledge(ctx), ...pcKnowledge(ctx)];
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

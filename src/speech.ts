import type { Mood } from "./lines";

const TYPE_MS = 38;
const LINGER_MS = 4500;

export interface SpeechHooks {
  onTalking(on: boolean): void;
  onLayout(): void;
  /** Called for every typed character (voice blips, mouth shapes). */
  onChar(ch: string): void;
}

/** The speech bubble above the face, with a typewriter effect and optional choice buttons. */
export class Speech {
  private readonly text: HTMLElement;
  private readonly choices: HTMLElement;
  private typing = 0;
  private hideTimer = 0;

  constructor(
    private readonly bubble: HTMLElement,
    private readonly hooks: SpeechHooks,
  ) {
    this.text = bubble.querySelector("#bubble-text")!;
    this.choices = bubble.querySelector("#bubble-choices")!;
  }

  get visible(): boolean {
    return !this.bubble.classList.contains("hidden");
  }

  private open(mood: Mood): void {
    window.clearInterval(this.typing);
    window.clearTimeout(this.hideTimer);
    this.bubble.classList.toggle("creepy", mood === "creepy");
    this.bubble.classList.remove("hidden");
    this.choices.replaceChildren();
  }

  say(line: string, mood: Mood, choices: string[] = [], onChoice?: (c: string) => void): void {
    this.open(mood);
    this.text.textContent = "";
    this.hooks.onTalking(true);
    this.hooks.onLayout();

    let i = 0;
    const chars = [...line];
    this.typing = window.setInterval(() => {
      const ch = chars[i++] ?? "";
      this.text.textContent += ch;
      this.hooks.onChar(ch);
      if (i < chars.length) return;
      window.clearInterval(this.typing);
      this.hooks.onTalking(false);
      for (const c of choices) {
        const btn = document.createElement("button");
        btn.textContent = c;
        btn.addEventListener("click", () => onChoice?.(c));
        this.choices.append(btn);
      }
      this.hooks.onLayout();
      // Questions wait for an answer; everything else fades out on its own.
      if (choices.length === 0) this.hideLater(LINGER_MS);
    }, TYPE_MS);
  }

  /** Show text instantly and keep it up (used while singing). */
  show(text: string, mood: Mood): void {
    this.open(mood);
    this.text.textContent = text;
    this.hooks.onLayout();
  }

  hideLater(ms: number): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    window.clearInterval(this.typing);
    window.clearTimeout(this.hideTimer);
    this.hooks.onTalking(false);
    this.bubble.classList.add("hidden");
    this.hooks.onLayout();
  }
}

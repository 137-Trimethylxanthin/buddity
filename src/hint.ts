// A small name tag that shows when the cursor rests on him: who he is and how
// to play with him, until the menu has been found once.
import { load, save } from "./store";

const HOVER_MS = 800;
const SEEN_KEY = "menuSeen";
const GAP = 10;

export class Hint {
  private timer = 0;
  private seen = load(SEEN_KEY) === "1";
  private readonly title: HTMLElement;
  private readonly line: HTMLElement;

  constructor(
    private readonly el: HTMLElement,
    /** Whether he can show it now, and what it says. Null: not now. */
    private readonly content: () => { title: string; status: string; creepy: boolean } | null,
  ) {
    this.title = el.querySelector(".hint-title")!;
    this.line = el.querySelector(".hint-line")!;
  }

  get visible(): boolean {
    return !this.el.classList.contains("hidden");
  }

  /** The cursor moved over him: show the tag once it has been still for a moment. */
  rest(): void {
    if (this.visible) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.classList.add("hidden");
  }

  /** The menu has been opened: the controls hint isn't needed any more. */
  menuSeen(): void {
    this.hide();
    if (this.seen) return;
    this.seen = true;
    save(SEEN_KEY, "1");
  }

  /** Keep it over his head (or under him near the top of the screen). */
  place(box: { x: number; y: number; w: number; h: number }, above: number): void {
    if (!this.visible) return;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const mid = box.x + box.w / 2;
    const left = Math.max(8, Math.min(innerWidth - w - 8, mid - w / 2));
    const up = box.y - above - h - GAP;
    const below = up < 8;
    this.el.classList.toggle("below", below);
    this.el.style.transform = `translate(${left}px, ${below ? box.y + box.h + GAP : up}px)`;
    this.el.style.setProperty("--tail", `${Math.max(16, Math.min(w - 16, mid - left))}px`);
  }

  private show(): void {
    const c = this.content();
    if (!c) return;
    this.title.textContent = c.title;
    this.line.textContent = this.seen ? c.status : "Click to pet · drag to throw · right-click for more";
    this.el.classList.toggle("seen", this.seen);
    this.el.classList.toggle("creepy", c.creepy);
    this.el.classList.remove("hidden");
  }
}

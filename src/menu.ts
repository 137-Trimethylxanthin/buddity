// The right-click menu that pops up next to Verity.

export interface MenuItem {
  label: string;
  action: () => void;
  /** Shown highlighted, e.g. the current skin. */
  active?: boolean;
}

const LEAVE_CLOSE_MS = 900;

export class ContextMenu {
  private leaveTimer = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onLayout: () => void,
  ) {
    el.addEventListener("mouseleave", () => {
      this.leaveTimer = window.setTimeout(() => this.close(), LEAVE_CLOSE_MS);
    });
    el.addEventListener("mouseenter", () => window.clearTimeout(this.leaveTimer));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.el.classList.contains("hidden");
  }

  /** Open at (x, y) in window pixels; each inner list is a section (a row of buttons). */
  open(x: number, y: number, sections: MenuItem[][]): void {
    window.clearTimeout(this.leaveTimer);
    this.el.replaceChildren(
      ...sections.map((items) => {
        const row = document.createElement("div");
        row.className = "menu-row";
        for (const item of items) {
          const btn = document.createElement("button");
          btn.textContent = item.label;
          btn.classList.toggle("active", !!item.active);
          btn.addEventListener("click", () => {
            this.close();
            item.action();
          });
          row.append(btn);
        }
        return row;
      }),
    );
    this.el.classList.remove("hidden");
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, x));
    const top = Math.max(8, Math.min(innerHeight - h - 8, y - h / 2));
    this.el.style.transform = `translate(${left}px, ${top}px)`;
    this.onLayout();
  }

  close(): void {
    window.clearTimeout(this.leaveTimer);
    this.el.classList.add("hidden");
    this.onLayout();
  }

  get element(): HTMLElement {
    return this.el;
  }
}

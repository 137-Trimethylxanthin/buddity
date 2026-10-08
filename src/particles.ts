// Little floating glyphs (music notes, hearts) that drift up from Verity and fade.

export function emit(stage: HTMLElement, x: number, y: number, glyph: string, color: string): void {
  const el = document.createElement("span");
  el.className = "particle";
  el.textContent = glyph;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  el.style.setProperty("--dx", `${Math.round(Math.random() * 80 - 40)}px`);
  el.style.setProperty("--spin", `${Math.round(Math.random() * 50 - 25)}deg`);
  el.addEventListener("animationend", () => el.remove());
  stage.append(el);
}

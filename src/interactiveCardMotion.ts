import type { PointerEvent } from "react";

export const interactiveCardMotion = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    card.style.setProperty("--card-tilt-x", `${(y - .5) * 10}deg`);
    card.style.setProperty("--card-tilt-y", `${(.5 - x) * 12}deg`);
    card.style.setProperty("--card-glow-x", `${x * 100}%`);
    card.style.setProperty("--card-glow-y", `${y * 100}%`);
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.removeProperty("--card-tilt-x");
    event.currentTarget.style.removeProperty("--card-tilt-y");
  },
};

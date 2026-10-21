import { scale } from "../../core/src/engine.js";

/** Format a scaled sample; a caller in a sibling package. */
export function render(value: number): string {
  return String(scale(value));
}

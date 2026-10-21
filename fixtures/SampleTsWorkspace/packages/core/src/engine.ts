/** Double one input sample. */
export function scale(value: number): number {
  return value * 2;
}

/** Scale twice; a caller inside the same package. */
export function twice(value: number): number {
  return scale(scale(value));
}

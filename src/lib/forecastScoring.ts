/** Multiclass Brier: sum over home/draw/away, range 0–2. */
export function brierScore(p: readonly number[], idx: number): number {
  return p.reduce((sum, v, i) => sum + (v - (i === idx ? 1 : 0)) ** 2, 0)
}

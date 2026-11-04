import type { Estimate } from './types';
export function wilson(wins: number, n: number): Estimate {
  const p = wins / n, z = 1.96, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const width = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return { mean: p, low: Math.max(0, center - width), high: Math.min(1, center + width) };
}
export class Moments {
  n = 0; mean = 0; m2 = 0;
  add(x: number) { this.n++; const d = x - this.mean; this.mean += d / this.n; this.m2 += d * (x - this.mean); }
  interval(bound?: [number, number]): Estimate {
    let radius = this.n > 1 ? 1.96 * Math.sqrt(this.m2 / (this.n - 1) / this.n) : Infinity;
    if (bound && Number.isFinite(bound[1] - bound[0]) && this.n > 1) {
      // Empirical Bernstein bound: identical samples still leave uncertainty
      // about rare outcomes. A zero sample variance must not imply exactness.
      const log = Math.log(4 / .05), range = bound[1] - bound[0];
      radius = Math.sqrt(2 * this.m2 / (this.n - 1) * log / this.n) + 7 * range * log / (3 * (this.n - 1));
    }
    return { mean: this.mean, low: Math.max(bound?.[0] ?? -Infinity, this.mean - radius), high: Math.min(bound?.[1] ?? Infinity, this.mean + radius) };
  }
}
export function qualifies(win: Estimate, loss: Estimate, minWin: number, maxLoss: number) { return win.low >= minWin && loss.high <= maxLoss; }

/**
 * Probability helpers. TxLINE publishes a DE-MARGINED `Pct` per price name (bookmaker margin already
 * removed; the values sum to ~100). That de-margined probability is the platform's headline edge — the
 * "fair" price is free data. We never recompute it from raw prices; we only parse + normalize it, and
 * synthesize a "book-style" price by re-applying a margin so the UI can show fair-vs-book side by side.
 */

/** Parse TxLINE `Pct` (string[] like ["27.420","48.450","24.131"] or number[]) into fractions summing to 1. */
export function deMarginedProbabilities(pct: Array<string | number>): number[] {
  const nums = pct.map((p) => (typeof p === "string" ? parseFloat(p) : p));
  const total = nums.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("deMarginedProbabilities: non-positive total");
  return nums.map((n) => n / total);
}

/** Implied (un-normalized) probabilities from decimal odds: 1/o each. Sums to 1 + overround. */
export function impliedFromDecimalOdds(odds: number[]): number[] {
  return odds.map((o) => 1 / o);
}

/** Bookmaker overround (vig) implied by a set of decimal odds: Σ(1/o) − 1. */
export function overround(odds: number[]): number {
  return impliedFromDecimalOdds(odds).reduce((a, b) => a + b, 0) - 1;
}

/** Fair decimal odds for a true probability p (1/p). */
export function fairDecimalOdds(p: number): number {
  if (p <= 0 || p > 1) throw new Error("fairDecimalOdds: p out of range");
  return 1 / p;
}

/**
 * The book-style implied probability a sportsbook would quote for a fair prob p at relative margin m:
 * q = p·(1+m). (Overround = Σ q_i − 1 = m when applied uniformly.)
 */
export function bookProbability(p: number, margin: number): number {
  return p * (1 + margin);
}

/** Book-style decimal odds for a fair prob p at relative margin m: 1/(p·(1+m)). Shorter than fair. */
export function bookDecimalOdds(p: number, margin: number): number {
  return 1 / bookProbability(p, margin);
}

/** American odds from a probability (for display). */
export function toAmericanOdds(p: number): number {
  const dec = 1 / p;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

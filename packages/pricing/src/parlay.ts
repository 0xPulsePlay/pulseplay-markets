/**
 * Parlay math — "what fair is worth". A book quotes each leg at implied q_i = p_i·(1+m_i); parlay
 * payouts MULTIPLY, so margin compounds geometrically:
 *
 *   payout_book / payout_fair = ∏ (p_i / q_i) = ∏ 1/(1+m_i) ≈ (1+m)^{−n}
 *
 * Three legs at a typical 6–10% relative margin → the bettor is paid 75–84% of fair. PulsePlay pays
 * the fair (blue-curve) price because TxLINE's de-margined Pct is already the true probability.
 */
import { jointProbGaussianCopula } from "./correlation.js";

export interface ParlayLeg {
  /** Fair (de-margined) probability of this leg, 0..1. */
  p: number;
  /** Relative bookmaker margin this leg would carry at a typical book (e.g. 0.06 = 6%). */
  margin: number;
  label?: string;
}

/** Fair parlay decimal odds assuming independence: ∏ (1/p_i). */
export function parlayFairOdds(probs: number[]): number {
  return probs.reduce((acc, p) => acc / p, 1);
}

/** Book parlay decimal odds: ∏ 1/(p_i·(1+m_i)). */
export function parlayBookOdds(legs: ParlayLeg[]): number {
  return legs.reduce((acc, l) => acc / (l.p * (1 + l.margin)), 1);
}

/** The share of the fair payout a book actually pays: ∏ 1/(1+m_i). */
export function parlayPayoutRatio(margins: number[]): number {
  return margins.reduce((acc, m) => acc / (1 + m), 1);
}

export interface ParlayComparison {
  legs: number;
  fairProbIndependent: number;
  fairOdds: number;
  bookOdds: number;
  payoutRatio: number; // book / fair, in (0,1]
  marginTax: number; // 1 − payoutRatio, the fraction of fair the margin quietly eats
  stake: number;
  fairPayout: number;
  bookPayout: number;
  /** Present only when correlations are supplied (adjacent-pair Gaussian-copula chain). */
  fairProbCorrelated?: number;
}

/**
 * Full fair-vs-book comparison for a parlay ticket. If `pairwiseRho` (length legs-1) is given, the
 * correlated joint probability is estimated via an adjacent-pair Gaussian-copula chain (honest
 * same-match correlation) — a conditional-independence approximation, not the full joint.
 */
export function compareParlay(legs: ParlayLeg[], stake = 1, pairwiseRho?: number[]): ParlayComparison {
  const probs = legs.map((l) => l.p);
  const fairProbIndependent = probs.reduce((a, p) => a * p, 1);
  const fairOdds = parlayFairOdds(probs);
  const bookOdds = parlayBookOdds(legs);
  const payoutRatio = parlayPayoutRatio(legs.map((l) => l.margin));

  let fairProbCorrelated: number | undefined;
  if (pairwiseRho && legs.length >= 2) {
    // chain: P(1..n) ≈ P(1)·∏ P(i|i-1), with P(i|i-1) = joint(p_{i-1},p_i,ρ)/p_{i-1}
    let joint = probs[0];
    for (let i = 1; i < probs.length; i++) {
      const rho = pairwiseRho[i - 1] ?? 0;
      const pairJoint = jointProbGaussianCopula(probs[i - 1], probs[i], rho);
      joint *= pairJoint / probs[i - 1];
    }
    fairProbCorrelated = joint;
  }

  return {
    legs: legs.length,
    fairProbIndependent,
    fairOdds,
    bookOdds,
    payoutRatio,
    marginTax: 1 - payoutRatio,
    stake,
    fairPayout: stake * fairOdds,
    bookPayout: stake * bookOdds,
    fairProbCorrelated,
  };
}

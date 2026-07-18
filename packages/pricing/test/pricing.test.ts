import { describe, it, expect } from "vitest";
import {
  deMarginedProbabilities, overround, fairDecimalOdds, bookDecimalOdds, bookProbability,
  LMSR,
  compareParlay, parlayPayoutRatio, parlayFairOdds,
  invNormCdf, normCdf, bivariateNormalCdf, jointProbGaussianCopula,
} from "../src/index.js";

describe("de-margined probabilities", () => {
  it("parses TxLINE Pct strings into fractions summing to 1", () => {
    const p = deMarginedProbabilities(["27.420", "48.450", "24.131"]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p[1]).toBeGreaterThan(p[0]); // draw was the biggest here
  });
  it("fair odds are the reciprocal; a book shortens them via margin", () => {
    expect(fairDecimalOdds(0.5)).toBeCloseTo(2, 10);
    expect(bookDecimalOdds(0.5, 0.06)).toBeLessThan(fairDecimalOdds(0.5));
    expect(bookProbability(0.5, 0.06)).toBeCloseTo(0.53, 10);
  });
  it("overround of a fair (de-margined) book is ~0", () => {
    const p = deMarginedProbabilities(["27.420", "48.450", "24.131"]);
    const fairOdds = p.map((x) => 1 / x);
    expect(overround(fairOdds)).toBeCloseTo(0, 6);
  });
});

describe("parlay fair-vs-book (spec table)", () => {
  it("payout ratio (1+m)^-n matches the spec: 3 legs @6% → 84.0%, @10% → 75.1%", () => {
    expect(parlayPayoutRatio([0.06, 0.06, 0.06])).toBeCloseTo(0.8396, 4);
    expect(parlayPayoutRatio([0.1, 0.1, 0.1])).toBeCloseTo(0.7513, 4);
  });
  it("reproduces the full spec table for 1..5 legs at 6% and 10%", () => {
    const at = (n: number, m: number) => parlayPayoutRatio(Array(n).fill(m));
    expect(at(1, 0.06)).toBeCloseTo(0.943, 3);
    expect(at(2, 0.06)).toBeCloseTo(0.890, 3);
    expect(at(4, 0.06)).toBeCloseTo(0.792, 3);
    expect(at(5, 0.06)).toBeCloseTo(0.747, 3);
    expect(at(2, 0.1)).toBeCloseTo(0.826, 3);
    expect(at(4, 0.1)).toBeCloseTo(0.683, 3);
    expect(at(5, 0.1)).toBeCloseTo(0.621, 3);
  });
  it("compareParlay: PulsePlay pays fair, the book pays the ratio", () => {
    const legs = [
      { p: 0.55, margin: 0.06, label: "England win" },
      { p: 0.60, margin: 0.06, label: "Over 2.5" },
      { p: 0.45, margin: 0.06, label: "Card shown" },
    ];
    const c = compareParlay(legs, 100);
    expect(c.fairOdds).toBeCloseTo(parlayFairOdds([0.55, 0.6, 0.45]), 8);
    expect(c.bookPayout).toBeLessThan(c.fairPayout);
    expect(c.bookPayout / c.fairPayout).toBeCloseTo(c.payoutRatio, 8);
    expect(c.payoutRatio).toBeCloseTo(0.8396, 4);
    expect(c.marginTax).toBeCloseTo(1 - 0.8396, 4);
  });
  it("correlation shrinks the joint toward >product for positively-correlated same-match legs", () => {
    const legs = [{ p: 0.55, margin: 0.06 }, { p: 0.6, margin: 0.06 }];
    const indep = compareParlay(legs, 1);
    const corr = compareParlay(legs, 1, [0.4]);
    expect(corr.fairProbCorrelated).toBeGreaterThan(indep.fairProbIndependent);
  });
});

describe("LMSR seeded at the fair prior", () => {
  it("opens exactly at the prior", () => {
    const prior = [0.2742, 0.4845, 0.2413];
    const m = LMSR.seededAtPrior(300, prior);
    const prices = m.prices();
    prices.forEach((px, i) => expect(px).toBeCloseTo(prior[i], 6));
  });
  it("worst-case loss bound b·ln(n) matches the spec table (b=300)", () => {
    expect(LMSR.maxLoss(300, 2)).toBeCloseTo(207.9, 1); // binary
    expect(LMSR.maxLoss(300, 3)).toBeCloseTo(329.6, 1); // 1X2
    expect(LMSR.maxLoss(1000, 2)).toBeCloseTo(693.1, 1);
  });
  it("shares to move a binary 30%→50% = b·0.847 ≈ 254 (spec figure); realized cash cost is lower", () => {
    // The spec's "$254" is the share/notional delta b·Δlogit (a worst-case upper bound on cash).
    expect(LMSR.costToMoveApprox(300, 0.3, 0.5)).toBeCloseTo(254.0, 0);
    // The realized LMSR cash cost C(q+Δ)−C(q) is strictly less (each share costs < $1 on the way up).
    const m = LMSR.seededAtPrior(300, [0.3, 0.7]);
    const cost = m.buyToPrice(0, 0.5);
    expect(cost).toBeCloseTo(100.94, 1);
    expect(cost).toBeLessThan(LMSR.costToMoveApprox(300, 0.3, 0.5));
    expect(m.price(0)).toBeCloseTo(0.5, 6);
  });
  it("prices always sum to 1 and buying raises the bought price", () => {
    const m = LMSR.seededAtPrior(300, [0.5, 0.5]);
    const before = m.price(0);
    m.buy(0, 100);
    expect(m.prices().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(m.price(0)).toBeGreaterThan(before);
  });
  it("cost to buy is positive and monotonic in shares", () => {
    const m = LMSR.seededAtPrior(300, [0.5, 0.5]);
    expect(m.costToBuy(0, 50)).toBeGreaterThan(0);
    expect(m.costToBuy(0, 100)).toBeGreaterThan(m.costToBuy(0, 50));
  });
});

describe("correlation primitives", () => {
  it("invNormCdf is the inverse of normCdf", () => {
    expect(invNormCdf(0.975)).toBeCloseTo(1.959964, 4);
    expect(normCdf(invNormCdf(0.3))).toBeCloseTo(0.3, 6);
  });
  it("bivariate normal CDF matches the closed form Φ₂(0,0,ρ)=¼+asin(ρ)/2π", () => {
    for (const rho of [-0.5, 0, 0.3, 0.7]) {
      const expected = 0.25 + Math.asin(rho) / (2 * Math.PI);
      expect(bivariateNormalCdf(0, 0, rho)).toBeCloseTo(expected, 4);
    }
  });
  it("joint under positive correlation exceeds the independent product", () => {
    const indep = 0.5 * 0.5;
    expect(jointProbGaussianCopula(0.5, 0.5, 0.5)).toBeGreaterThan(indep);
    expect(jointProbGaussianCopula(0.5, 0.5, 0)).toBeCloseTo(indep, 4);
  });
});

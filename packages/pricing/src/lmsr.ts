/**
 * Hanson's Logarithmic Market Scoring Rule (LMSR), seeded at the TxLINE de-margined prior so the pool
 * OPENS already-correct — which minimizes expected bleed. Liquidity parameter `b` sets depth and the
 * hard worst-case loss bound b·ln(n). Cost to move the price ≈ b·Δlogit.
 *
 * Prices: p_i(q) = softmax(q/b)_i.  Cost:  C(q) = b·ln Σ exp(q_i/b).  Buying Δ of outcome k costs
 * C(q+Δe_k) − C(q). Seeding at prior π: set q_i = b·ln(π_i) ⇒ p_i(q) = π_i exactly.
 */
export class LMSR {
  readonly b: number;
  readonly n: number;
  q: number[];

  constructor(b: number, n: number, q?: number[]) {
    if (b <= 0) throw new Error("LMSR: b must be > 0");
    if (n < 2) throw new Error("LMSR: need >= 2 outcomes");
    this.b = b;
    this.n = n;
    this.q = q ? [...q] : new Array(n).fill(0);
  }

  /** Seed inventory so the opening prices equal the given prior (must sum to ~1, all > 0). */
  static seededAtPrior(b: number, prior: number[]): LMSR {
    const total = prior.reduce((a, x) => a + x, 0);
    const norm = prior.map((x) => x / total);
    if (norm.some((x) => x <= 0)) throw new Error("LMSR.seededAtPrior: priors must be > 0");
    const q = norm.map((x) => b * Math.log(x));
    return new LMSR(b, prior.length, q);
  }

  /** Numerically-stable cost C(q) = b·ln Σ exp(q_i/b). */
  cost(q: number[] = this.q): number {
    const z = q.map((x) => x / this.b);
    const m = Math.max(...z);
    const s = z.reduce((a, x) => a + Math.exp(x - m), 0);
    return this.b * (m + Math.log(s));
  }

  /** Current instantaneous prices (softmax). Sum to 1. */
  prices(q: number[] = this.q): number[] {
    const z = q.map((x) => x / this.b);
    const m = Math.max(...z);
    const ex = z.map((x) => Math.exp(x - m));
    const s = ex.reduce((a, x) => a + x, 0);
    return ex.map((x) => x / s);
  }

  price(index: number): number {
    return this.prices()[index];
  }

  /** Cost to buy `shares` of outcome `index` (does not mutate). */
  costToBuy(index: number, shares: number): number {
    const q2 = [...this.q];
    q2[index] += shares;
    return this.cost(q2) - this.cost();
  }

  /**
   * Buy exactly enough shares of `index` to move its price from the current value to `targetPrice`
   * (single-outcome fill against the AMM; other inventories held fixed). Returns the cost. Mutates.
   */
  buyToPrice(index: number, targetPrice: number): number {
    if (targetPrice <= 0 || targetPrice >= 1) throw new Error("buyToPrice: target in (0,1)");
    // For a fixed other-inventory, price_i = 1/(1 + Σ_{j≠i} exp((q_j − q_i)/b)). Solve q_i.
    const others = this.q.filter((_, j) => j !== index).map((x) => x / this.b);
    const mo = Math.max(...others);
    const sOthers = others.reduce((a, x) => a + Math.exp(x - mo), 0); // Σ exp(q_j/b) scaled by exp(-mo)
    // price = e^{qi/b}/(e^{qi/b} + Σ e^{qj/b}); let A = Σ e^{qj/b} = e^{mo}·sOthers
    const A = Math.exp(mo) * sOthers;
    const target = (targetPrice * A) / (1 - targetPrice); // = e^{qi/b}
    const newQi = this.b * Math.log(target);
    const shares = newQi - this.q[index];
    const c = this.costToBuy(index, shares);
    this.q[index] = newQi;
    return c;
  }

  buy(index: number, shares: number): number {
    const c = this.costToBuy(index, shares);
    this.q[index] += shares;
    return c;
  }

  /** Hard worst-case subsidy loss for an n-outcome LMSR with liquidity b: b·ln(n). */
  static maxLoss(b: number, n: number): number {
    return b * Math.log(n);
  }

  /**
   * The share/notional delta to move a binary price p0→p1: b·(logit(p1) − logit(p0)). This is the
   * spec's "cost to move" figure and a worst-case upper bound on cash — the realized AMM cash outlay
   * (`buyToPrice`, = C(q+Δ)−C(q)) is strictly smaller since each share costs < $1 on the way up.
   */
  static costToMoveApprox(b: number, p0: number, p1: number): number {
    const logit = (p: number) => Math.log(p / (1 - p));
    return b * (logit(p1) - logit(p0));
  }
}

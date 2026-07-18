/**
 * Correlation, handled honestly. Fair-product parlay pricing ∏ p_i assumes independent legs. Same-match
 * legs are NOT independent (England winning correlates with over 2.5). We estimate the joint with a
 * Gaussian copula: p_{12} = Φ_ρ(Φ⁻¹(p_1), Φ⁻¹(p_2)), ρ fit per leg-pair class from the corpus. This is
 * the "we estimate the correlation books price against you" story — from anchored data, not vibes.
 */

/** Inverse standard-normal CDF (Acklam's rational approximation, |err| < 1.15e-9). */
export function invNormCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("invNormCdf: p in (0,1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

/** Standard-normal CDF via erf. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |err| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const GL16_X = [-0.0950125098, 0.0950125098, -0.2816035508, 0.2816035508, -0.4580167777, 0.4580167777, -0.6178762444, 0.6178762444, -0.7554044084, 0.7554044084, -0.8656312024, 0.8656312024, -0.9445750231, 0.9445750231, -0.9894009350, 0.9894009350];
const GL16_W = [0.1894506105, 0.1894506105, 0.1826034150, 0.1826034150, 0.1691565194, 0.1691565194, 0.1495959888, 0.1495959888, 0.1246289713, 0.1246289713, 0.0951585117, 0.0951585117, 0.0622535239, 0.0622535239, 0.0271524594, 0.0271524594];

/**
 * Bivariate standard-normal CDF Φ₂(h,k,ρ) via Sheppard's identity:
 *   Φ₂(h,k,ρ) = Φ(h)Φ(k) + ∫₀^ρ (1/2π)·(1/√(1−r²))·exp(−(h²−2rhk+k²)/(2(1−r²))) dr
 * integrated with 16-point Gauss–Legendre. Exact-ish: Φ₂(0,0,ρ)=¼+asin(ρ)/2π.
 */
export function bivariateNormalCdf(h: number, k: number, rho: number): number {
  if (rho <= -1 || rho >= 1) {
    if (rho >= 1) return normCdf(Math.min(h, k));
    return Math.max(0, normCdf(h) + normCdf(k) - 1);
  }
  const base = normCdf(h) * normCdf(k);
  const half = rho / 2;
  let integral = 0;
  for (let i = 0; i < GL16_X.length; i++) {
    const r = half * GL16_X[i] + half; // map [-1,1] → [0,ρ]
    const oneMinus = 1 - r * r;
    const dens = (1 / (2 * Math.PI)) * (1 / Math.sqrt(oneMinus)) * Math.exp(-(h * h - 2 * r * h * k + k * k) / (2 * oneMinus));
    integral += GL16_W[i] * dens;
  }
  integral *= half;
  return base + integral;
}

/** Joint P(A ∧ B) for two marginal probs under a Gaussian copula with correlation ρ. */
export function jointProbGaussianCopula(p1: number, p2: number, rho: number): number {
  const h = invNormCdf(p1);
  const k = invNormCdf(p2);
  return bivariateNormalCdf(h, k, rho);
}

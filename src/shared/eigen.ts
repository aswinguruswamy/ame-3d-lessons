/**
 * Small eigenvalue solver for the linear models in the lessons (n ≤ 8).
 * Characteristic polynomial by Faddeev–LeVerrier, roots by Durand–Kerner.
 */
export interface Complex {
  re: number;
  im: number;
}

type Matrix = number[][];

const identity = (n: number): Matrix => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

function mul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const out: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) out[i][j] += aik * b[k][j];
    }
  return out;
}

/** Coefficients c[0..n] of det(λI − A) = Σ c[k] λ^k, with c[n] = 1. */
export function characteristicPolynomial(A: Matrix): number[] {
  const n = A.length;
  const c = new Array(n + 1).fill(0);
  c[n] = 1;
  let M: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const I = identity(n);
  for (let k = 1; k <= n; k++) {
    const AM = mul(A, M);
    M = AM.map((row, i) => row.map((v, j) => v + c[n - k + 1] * I[i][j]));
    const AMk = mul(A, M);
    let tr = 0;
    for (let i = 0; i < n; i++) tr += AMk[i][i];
    c[n - k] = -tr / k;
  }
  return c;
}

/** Roots of a monic polynomial given by coefficients c[0..n] (c[n] = 1). */
export function polynomialRoots(c: number[], iterations = 500): Complex[] {
  const n = c.length - 1;
  let z: Complex[] = Array.from({ length: n }, (_, k) => {
    // standard start: points on a circle, slightly rotated
    const a = (2 * Math.PI * k) / n + 0.4;
    const r = 1 + Math.max(...c.slice(0, n).map(Math.abs)) ** (1 / n) * 0.5;
    return { re: r * Math.cos(a), im: r * Math.sin(a) };
  });
  const evalP = (x: Complex): Complex => {
    let re = c[n];
    let im = 0;
    for (let k = n - 1; k >= 0; k--) {
      const nr = re * x.re - im * x.im + c[k];
      im = re * x.im + im * x.re;
      re = nr;
    }
    return { re, im };
  };
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    const next = z.map((zi, i) => {
      let dre = 1;
      let dim = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const ar = zi.re - z[j].re;
        const ai = zi.im - z[j].im;
        const nr = dre * ar - dim * ai;
        dim = dre * ai + dim * ar;
        dre = nr;
      }
      const p = evalP(zi);
      const den = dre * dre + dim * dim || 1e-30;
      const qre = (p.re * dre + p.im * dim) / den;
      const qim = (p.im * dre - p.re * dim) / den;
      moved = Math.max(moved, Math.hypot(qre, qim));
      return { re: zi.re - qre, im: zi.im - qim };
    });
    z = next;
    if (moved < 1e-13) break;
  }
  return z;
}

export function eigenvalues(A: Matrix): Complex[] {
  return polynomialRoots(characteristicPolynomial(A));
}

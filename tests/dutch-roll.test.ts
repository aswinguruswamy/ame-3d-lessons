import { describe, expect, it } from 'vitest';
import { eigenvalues } from '../src/shared/eigen';
import {
  DEFAULT_PARAMS,
  DutchRollSim,
  I,
  dutchRollLikely,
  dutchRollMode,
  simulateRun,
} from '../src/lessons/dutch-roll/physics';

const off = { ...DEFAULT_PARAMS, yawDamper: false };
const on = { ...DEFAULT_PARAMS, yawDamper: true };

/** Peaks of |r| (local maxima) in a run. */
function peaks(run: { t: number; r: number }[]) {
  const out: { t: number; a: number }[] = [];
  for (let i = 1; i < run.length - 1; i++) {
    const a = Math.abs(run[i].r);
    if (a > Math.abs(run[i - 1].r) && a >= Math.abs(run[i + 1].r)) out.push({ t: run[i].t, a });
  }
  return out;
}

describe('eigen solver', () => {
  it('finds the roots of a known matrix', () => {
    // λ² + 2ζω λ + ω² with ζ = 0.1, ω = 2  →  −0.2 ± 1.98997i ; plus λ = −3
    const A = [
      [0, 1, 0],
      [-4, -0.4, 0],
      [0, 0, -3],
    ];
    const roots = eigenvalues(A).sort((a, b) => a.im - b.im);
    expect(roots[2].re).toBeCloseTo(-0.2, 8);
    expect(roots[2].im).toBeCloseTo(Math.sqrt(4 - 0.04), 8);
    expect(roots[1].re).toBeCloseTo(-3, 8);
  });
});

describe('Dutch roll', () => {
  it('is lightly damped with the yaw damper OFF and keeps going for many cycles', () => {
    const m = dutchRollMode(off);
    expect(m.zeta).toBeGreaterThan(0);
    expect(m.zeta).toBeLessThan(0.08);
    const run = simulateRun(off, 40);
    const pk = peaks(run);
    // one |r| peak per half-cycle: at least 6 full cycles in 40 s, still > 20 % amplitude
    expect(pk.length).toBeGreaterThanOrEqual(12);
    expect(pk[pk.length - 1].a / pk[0].a).toBeGreaterThan(0.2);
  });

  it('decays within a few cycles with the yaw damper ON', () => {
    const m = dutchRollMode(on);
    expect(m.zeta).toBeGreaterThan(0.25);
    const run = simulateRun(on, 40);
    const first = Math.max(...run.filter((s) => s.t < 3).map((s) => Math.abs(s.r)));
    const after = Math.max(...run.filter((s) => s.t > 3 * m.period).map((s) => Math.abs(s.r)));
    expect(after / first).toBeLessThan(0.1);
  });

  it('moves the rudder against the yaw rate', () => {
    const sim = new DutchRollSim(on);
    sim.disturb('gust');
    let opposing = 0;
    let counted = 0;
    for (let i = 0; i < 120 * 15; i++) {
      sim.stepOnce(1 / 120);
      const r = sim.x[I.r];
      const dr = sim.x[I.dr];
      if (Math.abs(r) > 0.002 && Math.abs(dr) > 0.0005) {
        counted++;
        if (r * dr < 0) opposing++;
      }
    }
    expect(counted).toBeGreaterThan(100);
    expect(opposing / counted).toBeGreaterThan(0.85);
  });

  it('matches the eigenvalue damping in the time response (log decrement)', () => {
    const m = dutchRollMode(off);
    const pk = peaks(simulateRun(off, 60));
    // compare peaks two half-cycles apart (one full period), well after the start
    const a = pk[6];
    const b = pk[pk.length - 3];
    const sigmaSim = Math.log(b.a / a.a) / (b.t - a.t);
    expect(sigmaSim).toBeCloseTo(m.sigma, 2);
  });

  it('shows "Dutch roll likely" when the dihedral effect is much stronger', () => {
    expect(dutchRollLikely({ ...off, clBeta: 0.25, cnBeta: 0.05 })).toBe(true);
    expect(dutchRollLikely({ ...off, clBeta: 0.05, cnBeta: 0.2 })).toBe(false);
  });

  it('gets less damped as the dihedral effect grows', () => {
    const low = dutchRollMode({ ...off, clBeta: 0.05 }).zeta;
    const high = dutchRollMode({ ...off, clBeta: 0.25 }).zeta;
    expect(high).toBeLessThan(low);
  });

  it('can be reset to straight flight', () => {
    const sim = new DutchRollSim(off);
    sim.disturb('doublet');
    for (let i = 0; i < 600; i++) sim.stepOnce(1 / 120);
    sim.reset();
    expect([...sim.x].every((v) => v === 0)).toBe(true);
  });

  it('prints mode data for the README', () => {
    for (const p of [off, on]) {
      const m = dutchRollMode(p);
      console.log(p.yawDamper ? 'YD ON ' : 'YD OFF', `ζ=${m.zeta.toFixed(3)} T=${m.period.toFixed(2)}s t½=${m.tHalf.toFixed(1)}s`);
    }
    for (const g of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      const m = dutchRollMode({ ...on, gain: g });
      console.log(`K=${g}`, `ζ=${m.zeta.toFixed(3)} T=${m.period.toFixed(2)}`);
    }
  });
});

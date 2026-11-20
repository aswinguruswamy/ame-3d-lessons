import { describe, expect, it } from 'vitest';
import { MAGNUS } from '../src/config/magnus';
import {
  cpSurface,
  liftByPressureIntegral,
  magnusState,
  rpmToRadPerSec,
  velocityAt,
} from '../src/lessons/magnus/physics';

const base = { rpm: 2000, airspeed: 10, spinOn: true, direction: 'cw' as const };

describe('Magnus lift', () => {
  it('is zero when the spin is OFF', () => {
    const s = magnusState({ ...base, spinOn: false });
    expect(s.liftPerSpan).toBe(0);
    expect(s.deltaP).toBe(0);
  });

  it('points up for clockwise spin and reverses for counter-clockwise', () => {
    const cw = magnusState(base);
    const ccw = magnusState({ ...base, direction: 'ccw' });
    expect(cw.liftPerSpan).toBeGreaterThan(0);
    expect(ccw.liftPerSpan).toBeCloseTo(-cw.liftPerSpan, 10);
  });

  it('matches L′ = ρ·V·Γ with Γ = 2π r² ω', () => {
    const s = magnusState(base);
    const omega = rpmToRadPerSec(base.rpm);
    const gamma = 2 * Math.PI * MAGNUS.radius ** 2 * omega;
    expect(s.gamma).toBeCloseTo(gamma, 10);
    expect(s.liftPerSpan).toBeCloseTo(MAGNUS.rho * base.airspeed * gamma, 10);
  });

  it('equals the integral of surface pressure (Kutta–Joukowski check)', () => {
    for (const rpm of [300, 1000, 2000, 3000]) {
      for (const airspeed of [4, 10, 25]) {
        const s = magnusState({ ...base, rpm, airspeed });
        expect(liftByPressureIntegral(s)).toBeCloseTo(s.liftPerSpan, 6);
      }
    }
  });

  it('grows with spin rate and with airspeed', () => {
    const a = magnusState({ ...base, rpm: 1000 }).liftPerSpan;
    const b = magnusState({ ...base, rpm: 2000 }).liftPerSpan;
    const c = magnusState({ ...base, rpm: 1000, airspeed: 20 }).liftPerSpan;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(a);
  });

  it('is limited at Prandtl’s limit Γmax = 4π r V', () => {
    const s = magnusState({ ...base, rpm: 3000, airspeed: 2 });
    expect(s.limited).toBe(true);
    expect(s.gamma).toBeCloseTo(4 * Math.PI * MAGNUS.radius * 2, 10);
  });
});

describe('Flow field', () => {
  it('has no flow through the surface', () => {
    for (let i = 0; i < 36; i++) {
      const th = (i / 36) * 2 * Math.PI;
      const x = Math.cos(th) * 1.000001;
      const y = Math.sin(th) * 1.000001;
      const [u, v] = velocityAt(x, y, 0.8);
      expect(Math.abs(u * Math.cos(th) + v * Math.sin(th))).toBeLessThan(1e-4);
    }
  });

  it('returns to the free stream far away', () => {
    const [u, v] = velocityAt(-200, 3, 1);
    expect(u).toBeCloseTo(1, 2);
    expect(v).toBeCloseTo(0, 2);
  });

  it('is symmetric (equal top and bottom pressure) with no spin', () => {
    expect(cpSurface(Math.PI / 2, 0)).toBeCloseTo(cpSurface(-Math.PI / 2, 0), 12);
  });

  it('has lower pressure on top for clockwise spin', () => {
    expect(cpSurface(Math.PI / 2, 1)).toBeLessThan(cpSurface(-Math.PI / 2, 1));
  });
});

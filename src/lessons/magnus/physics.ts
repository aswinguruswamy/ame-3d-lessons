/**
 * Magnus effect physics (2-D ideal flow around a spinning cylinder).
 *
 * Coordinates: x = downstream, y = up. The free stream moves in +x.
 * Spin is signed: positive = CLOCKWISE when you look at the cylinder from the front (+z).
 * A clockwise cylinder moves its top surface downstream, so the top air is faster
 * and the lift points UP.
 *
 * Non-dimensional form: lengths in cylinder radii, velocities in free-stream units.
 * Then the only parameter is k = Γ / (2π·r·V) = spin ratio α (limited to ±2).
 */
import { MAGNUS } from '../../config/magnus';

export type Direction = 'cw' | 'ccw';

export interface MagnusInput {
  rpm: number;
  airspeed: number; // m/s
  spinOn: boolean;
  direction: Direction;
}

export interface MagnusState {
  /** Signed spin, rad/s (+ = clockwise). */
  omega: number;
  /** Surface speed ω·r, m/s (signed). */
  surfaceSpeed: number;
  /** Spin ratio α = ω·r / V (signed, before the limit). */
  spinRatio: number;
  /** Spin ratio used for the flow (limited to ±maxSpinRatio). */
  k: number;
  /** True when the ideal-theory limit is active. */
  limited: boolean;
  /** Circulation Γ, m²/s (signed, + = clockwise). */
  gamma: number;
  /** Lift per unit span L′ = ρ·V·Γ, N/m (+ = up). */
  liftPerSpan: number;
  /** Dynamic pressure q = ½ρV², Pa. */
  q: number;
  /** Pressure difference between the slow side and the fast side, Pa (≥ 0). */
  deltaP: number;
}

export const rpmToRadPerSec = (rpm: number) => (rpm * 2 * Math.PI) / 60;

/** Steady state for a given spin (rad/s, signed) and airspeed. */
export function stateFromOmega(omega: number, airspeed: number): MagnusState {
  const { rho, radius: a, maxSpinRatio } = MAGNUS;
  const V = Math.max(airspeed, 1e-6);
  const surfaceSpeed = omega * a;
  const spinRatio = surfaceSpeed / V;
  const k = Math.max(-maxSpinRatio, Math.min(maxSpinRatio, spinRatio));
  const gamma = 2 * Math.PI * a * V * k; // = 2π r² ω when not limited
  const q = 0.5 * rho * V * V;
  return {
    omega,
    surfaceSpeed,
    spinRatio,
    k,
    limited: Math.abs(spinRatio) > maxSpinRatio,
    gamma,
    liftPerSpan: rho * V * gamma, // Kutta–Joukowski
    q,
    // Cp(bottom) − Cp(top) = (2 + k)² − (2 − k)² = 8k
    deltaP: Math.abs(8 * k * q),
  };
}

export function magnusState(input: MagnusInput): MagnusState {
  const sign = input.direction === 'cw' ? 1 : -1;
  const omega = input.spinOn ? sign * rpmToRadPerSec(input.rpm) : 0;
  return stateFromOmega(omega, input.airspeed);
}

/**
 * Ideal-flow velocity at (x, y) in radii, for spin ratio k. Result in free-stream units.
 * Writes [u, v] into `out`. Inside the cylinder the result is zero.
 */
export function velocityAt(x: number, y: number, k: number, out: [number, number] = [0, 0]): [number, number] {
  const r2 = x * x + y * y;
  if (r2 < 1) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const r = Math.sqrt(r2);
  const c = x / r;
  const s = y / r;
  const ur = (1 - 1 / r2) * c;
  const ut = -(1 + 1 / r2) * s - k / r; // clockwise circulation adds −k/r
  out[0] = ur * c - ut * s;
  out[1] = ur * s + ut * c;
  return out;
}

/** Pressure coefficient Cp = 1 − (V_local / V∞)² at a point (Bernoulli). */
export function cpAt(x: number, y: number, k: number): number {
  const [u, v] = velocityAt(x, y, k, tmp);
  return 1 - (u * u + v * v);
}
const tmp: [number, number] = [0, 0];

/** Surface pressure coefficient at angle θ (radians, measured from +x, counter-clockwise). */
export function cpSurface(theta: number, k: number): number {
  const ut = 2 * Math.sin(theta) + k;
  return 1 - ut * ut;
}

/**
 * Lift per span from integrating surface pressure (used in tests to check
 * Kutta–Joukowski). L′ = −∮ (p − p∞) · n_y ds.
 */
export function liftByPressureIntegral(state: MagnusState, n = 720): number {
  const a = MAGNUS.radius;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) / n) * 2 * Math.PI;
    sum += -state.q * cpSurface(th, state.k) * Math.sin(th);
  }
  return sum * a * ((2 * Math.PI) / n);
}

/** Wake deflection angle δ (radians, + = air turned upward). Visual model only. */
export function wakeAngle(k: number): number {
  const { gain, maxAngle } = MAGNUS.wake;
  // Lift up (k > 0) → air pushed down (negative angle).
  return -Math.max(-maxAngle, Math.min(maxAngle, gain * k));
}

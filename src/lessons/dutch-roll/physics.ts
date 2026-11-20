/**
 * Linear lateral-directional model of an A320-class airliner, with a yaw damper.
 *
 * States (stability axes, small angles):
 *   β  sideslip (rad, + = air from the right / nose left of the flight path)
 *   p  roll rate (rad/s, + = right wing down)
 *   r  yaw rate (rad/s, + = nose right)
 *   φ  roll angle (rad, + = right wing down)
 *   ψ  heading change (rad, + = nose right)          — for display only
 *   w  washout-filter state (rad/s)                   — yaw damper
 *   δr rudder deflection (rad, + = trailing edge right → nose right)
 *
 * Equations [Nelson Ch. 5]:
 *   β̇ = Yβ β + (g/V) φ − r + Yδr δr
 *   ṗ = Lβ β + Lp p + Lr r + Lδr δr
 *   ṙ = Nβ β + Np p + Nr r + Nδr δr
 *   φ̇ = p,  ψ̇ = r
 * Yaw damper [Nelson Ch. 10]:
 *   washed-out yaw rate r_wo = r − w,  ẇ = (r − w)/τ   (i.e. r_wo = s/(s + 1/τ) · r)
 *   rudder command δr_cmd = −K · r_wo  (limited to the yaw-damper authority)
 *   rudder actuator δ̇r = (δr_cmd − δr)/τa, limited to the rudder rate limit
 */
import { DUTCH_ROLL as C } from '../../config/dutchRoll';
import { eigenvalues } from '../../shared/eigen';

export interface DRParams {
  /** Size of the dihedral effect |Clβ| (the model uses Clβ = −value). */
  clBeta: number;
  /** Weathervane effect Cnβ. */
  cnBeta: number;
  /** Yaw-damper gain K, s. */
  gain: number;
  /** True airspeed, m/s. */
  airspeed: number;
  yawDamper: boolean;
}

export const DEFAULT_PARAMS: DRParams = {
  clBeta: C.sliders.clBeta.default,
  cnBeta: C.sliders.cnBeta.default,
  gain: C.sliders.gain.default,
  airspeed: C.sliders.airspeed.default,
  yawDamper: false,
};

export const I = { beta: 0, p: 1, r: 2, phi: 3, psi: 4, w: 5, dr: 6 } as const;
export const N_STATES = 7;

export interface Dimensional {
  Yb: number;
  Ydr: number;
  gV: number;
  Lb: number;
  Lp: number;
  Lr: number;
  Ldr: number;
  Nb: number;
  Np: number;
  Nr: number;
  Ndr: number;
}

/** Converts the non-dimensional derivatives to dimensional ones for the given speed. */
export function dimensional(params: DRParams): Dimensional {
  const { rho, g, mass: m, inertia, geometry, derivatives: d } = C;
  const V = params.airspeed;
  const q = 0.5 * rho * V * V;
  const S = geometry.area;
  const b = geometry.span;
  const k = b / (2 * V);
  const Clb = -Math.abs(params.clBeta);
  const Cnb = params.cnBeta;
  return {
    Yb: (q * S * d.Cy_beta) / (m * V),
    Ydr: (q * S * d.Cy_dr) / (m * V),
    gV: g / V,
    Lb: (q * S * b * Clb) / inertia.Ixx,
    Lp: (q * S * b * d.Cl_p * k) / inertia.Ixx,
    Lr: (q * S * b * d.Cl_r * k) / inertia.Ixx,
    Ldr: (q * S * b * d.Cl_dr) / inertia.Ixx,
    Nb: (q * S * b * Cnb) / inertia.Izz,
    Np: (q * S * b * d.Cn_p * k) / inertia.Izz,
    Nr: (q * S * b * d.Cn_r * k) / inertia.Izz,
    Ndr: (q * S * b * d.Cn_dr) / inertia.Izz,
  };
}

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/** Rudder command from the yaw damper (rad). */
export function yawDamperCommand(params: DRParams, r: number, w: number): number {
  if (!params.yawDamper) return 0;
  return clamp(-params.gain * (r - w), C.yawDamper.authority);
}

/** State derivative. `pilot` is the pilot's rudder command (rad). */
export function derivative(x: Float64Array, params: DRParams, D: Dimensional, pilot: number, out: Float64Array) {
  const beta = x[I.beta];
  const p = x[I.p];
  const r = x[I.r];
  const phi = x[I.phi];
  const w = x[I.w];
  const dr = x[I.dr];
  const cmd = clamp(pilot + yawDamperCommand(params, r, w), C.rudderLimit);
  out[I.beta] = D.Yb * beta + D.gV * phi - r + D.Ydr * dr;
  out[I.p] = D.Lb * beta + D.Lp * p + D.Lr * r + D.Ldr * dr;
  out[I.r] = D.Nb * beta + D.Np * p + D.Nr * r + D.Ndr * dr;
  out[I.phi] = p;
  out[I.psi] = r;
  out[I.w] = (r - w) / C.yawDamper.washoutTau;
  out[I.dr] = clamp((cmd - dr) / C.yawDamper.actuatorTau, C.yawDamper.rateLimit);
}

export type Disturbance = 'gust' | 'doublet';

/** Fixed-step RK4 simulation. */
export class DutchRollSim {
  readonly x = new Float64Array(N_STATES);
  t = 0;
  /** Time of the last disturbance, s (or −Infinity). */
  tDisturb = -Infinity;
  /** True when the motion left the range where the linear model is valid. */
  outOfRange = false;
  private D: Dimensional;
  private doubletStart = -Infinity;
  private readonly k1 = new Float64Array(N_STATES);
  private readonly k2 = new Float64Array(N_STATES);
  private readonly k3 = new Float64Array(N_STATES);
  private readonly k4 = new Float64Array(N_STATES);
  private readonly tmp = new Float64Array(N_STATES);
  private acc = 0;

  constructor(public params: DRParams = { ...DEFAULT_PARAMS }) {
    this.D = dimensional(params);
  }

  setParams(p: DRParams) {
    this.params = { ...p };
    this.D = dimensional(this.params);
  }

  reset() {
    this.x.fill(0);
    this.t = 0;
    this.tDisturb = -Infinity;
    this.doubletStart = -Infinity;
    this.outOfRange = false;
    this.acc = 0;
  }

  disturb(kind: Disturbance) {
    this.outOfRange = false;
    this.tDisturb = this.t;
    if (kind === 'gust') this.x[I.beta] += C.disturbance.gustBeta;
    else this.doubletStart = this.t;
  }

  /** Pilot rudder command at time t: a doublet (+A, then −A). */
  pilotRudder(t: number): number {
    const s = t - this.doubletStart;
    const h = C.disturbance.doubletHalf;
    if (s < 0 || s >= 2 * h) return 0;
    return s < h ? C.disturbance.doubletAmp : -C.disturbance.doubletAmp;
  }

  /** Current rudder command (rad), for the indicator. */
  rudderCommand(): number {
    return clamp(this.pilotRudder(this.t) + yawDamperCommand(this.params, this.x[I.r], this.x[I.w]), C.rudderLimit);
  }

  /** One RK4 step of length h. */
  stepOnce(h: number) {
    const { x, k1, k2, k3, k4, tmp, params, D } = this;
    const t = this.t;
    derivative(x, params, D, this.pilotRudder(t), k1);
    for (let i = 0; i < N_STATES; i++) tmp[i] = x[i] + 0.5 * h * k1[i];
    derivative(tmp, params, D, this.pilotRudder(t + 0.5 * h), k2);
    for (let i = 0; i < N_STATES; i++) tmp[i] = x[i] + 0.5 * h * k2[i];
    derivative(tmp, params, D, this.pilotRudder(t + 0.5 * h), k3);
    for (let i = 0; i < N_STATES; i++) tmp[i] = x[i] + h * k3[i];
    derivative(tmp, params, D, this.pilotRudder(t + h), k4);
    for (let i = 0; i < N_STATES; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    this.t += h;
    if (Math.abs(x[I.beta]) > C.validity.beta || Math.abs(x[I.phi]) > C.validity.phi) this.outOfRange = true;
  }

  /** Advances by real time `dt` using fixed steps of C.dt. Calls `onStep` after each step. */
  advance(dt: number, onStep?: () => void) {
    if (this.outOfRange) return;
    this.acc += dt;
    while (this.acc >= C.dt) {
      this.acc -= C.dt;
      this.stepOnce(C.dt);
      onStep?.();
      if (this.outOfRange) {
        this.acc = 0;
        return;
      }
    }
  }
}

export interface ModeInfo {
  /** Damping ratio ζ. */
  zeta: number;
  /** Natural frequency ωn, rad/s. */
  wn: number;
  /** Damped period T = 2π/ωd, s. */
  period: number;
  /** Time to half amplitude (or to double, if unstable), s. */
  tHalf: number;
  /** Real part σ = −ζ ωn, 1/s. */
  sigma: number;
  stable: boolean;
}

/** Linear system matrix (without ψ) including the washout filter and actuator. No limits. */
export function systemMatrix(params: DRParams): number[][] {
  const D = dimensional(params);
  const K = params.yawDamper ? params.gain : 0;
  const tw = C.yawDamper.washoutTau;
  const ta = C.yawDamper.actuatorTau;
  // order: β, p, r, φ, w, δr
  return [
    [D.Yb, 0, -1, D.gV, 0, D.Ydr],
    [D.Lb, D.Lp, D.Lr, 0, 0, D.Ldr],
    [D.Nb, D.Np, D.Nr, 0, 0, D.Ndr],
    [0, 1, 0, 0, 0, 0],
    [0, 0, 1 / tw, 0, -1 / tw, 0],
    [0, 0, -K / ta, 0, K / ta, -1 / ta],
  ];
}

/**
 * Dutch roll mode. Without the yaw damper it is the only oscillatory pair. With the yaw
 * damper on, the actuator can add another pair, so we take the oscillatory root closest
 * to the yaw-damper-OFF Dutch roll root.
 */
export function dutchRollMode(params: DRParams): ModeInfo {
  const open = eigenvalues(systemMatrix({ ...params, yawDamper: false }));
  let ref = null as null | { re: number; im: number };
  for (const z of open) if (z.im > 1e-4 && (!ref || z.im > ref.im)) ref = z;
  const roots = params.yawDamper ? eigenvalues(systemMatrix(params)) : open;
  let best = null as null | { re: number; im: number };
  const dist = (z: { re: number; im: number }) => (ref ? Math.hypot(z.re - ref.re, z.im - ref.im) : -z.im);
  for (const z of roots) if (z.im > 1e-4 && (!best || dist(z) < dist(best))) best = z;
  if (!best) return { zeta: 1, wn: 0, period: Infinity, tHalf: 0, sigma: -1, stable: true };
  const wn = Math.hypot(best.re, best.im);
  const zeta = -best.re / wn;
  return {
    zeta,
    wn,
    period: (2 * Math.PI) / best.im,
    tHalf: Math.LN2 / Math.abs(best.re || 1e-9),
    sigma: best.re,
    stable: best.re < 0,
  };
}

/** True when the dihedral effect is much stronger than the weathervane effect. */
export function dutchRollLikely(params: DRParams): boolean {
  return Math.abs(params.clBeta) / params.cnBeta > C.dutchRollRatioLimit;
}

/** Simulates a gust response off-line (for the overlay graph). Returns samples every `every` s. */
export function simulateRun(params: DRParams, seconds: number, every = 1 / 30, kind: Disturbance = 'gust') {
  const sim = new DutchRollSim(params);
  sim.disturb(kind);
  const out: { t: number; r: number; phi: number; dr: number }[] = [];
  let next = 0;
  while (sim.t <= seconds + 1e-9) {
    if (sim.t >= next - 1e-9) {
      out.push({ t: sim.t, r: sim.x[I.r], phi: sim.x[I.phi], dr: sim.x[I.dr] });
      next += every;
    }
    sim.stepOnce(C.dt);
    if (sim.outOfRange) break;
  }
  return out;
}

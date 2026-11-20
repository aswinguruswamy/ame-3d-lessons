/**
 * Lesson 1 3D scene: spinning cylinder in a uniform airflow.
 * This module (and Three.js) is loaded only when the lesson page opens.
 *
 * Scene units: 1 unit = cylinder radius. x = downstream, y = up, z = cylinder axis (toward viewer).
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  GridHelper,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  TorusGeometry,
  ConeGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { MAGNUS } from '../../config/magnus';
import { pressureColor } from '../../shared/colormap';
import { Arrow, ArrowField } from '../../shared/arrows';
import { Placard, PlacardSet } from '../../shared/placards';
import { Viewer } from '../../shared/viewer';
import {
  cpSurface,
  rpmToRadPerSec,
  stateFromOmega,
  velocityAt,
  wakeAngle,
  type Direction,
  type MagnusState,
} from './physics';

export interface MagnusParams {
  rpm: number;
  airspeed: number;
  spinOn: boolean;
  direction: Direction;
  pressureMap: boolean;
  pressureArrows: boolean;
}

const LENGTH = 8;
const HALF = LENGTH / 2;
const X_MIN = -11;
const X_MAX = 12;
const Y_SPAN = 5.8;
const BL_THICK = 0.17;

const COLORS = {
  ink: 0x1d2733,
  inkSoft: 0x56616e,
  accent: 0xd9822b,
  lift: 0x1f8a4c,
  freeStream: 0x46586b,
  boundary: 0x1f7a70,
  wake: 0x8a5cc2,
  bg: 0xf3f1ec,
};

const { cpLow, cpHigh } = MAGNUS.draw;
const rgb = new Float32Array(3);
const tmpColor = new Color();
function cpToColor(cp: number, out: Color) {
  pressureColor(cp, cpLow, cpHigh, rgb);
  return out.setRGB(rgb[0], rgb[1], rgb[2]);
}

/** Smooth step 0→1 between e0 and e1. */
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Wake centre-line y(x) for a deflection angle δ. Starts level, then turns to slope tanδ. */
const wakeCentre = (x: number, delta: number) => {
  const s = Math.max(0, x - 0.8);
  return (Math.tan(delta) * s * s) / (s + 2);
};

/**
 * Streaks: many short thin boxes, one per air particle, drawn with one instanced mesh.
 * Each streak points along the local velocity; its length grows with speed.
 */
class Streaks {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  constructor(count: number, thickness: number) {
    const geo = new BoxGeometry(1, thickness, thickness).translate(-0.5, 0, 0);
    const mat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, tmpColor.setHex(0xffffff));
  }
  set(i: number, x: number, y: number, z: number, ux: number, uy: number, len: number) {
    const sp = Math.hypot(ux, uy) || 1;
    const c = ux / sp;
    const s = uy / sp;
    // rotation about z, scale x by len
    this.m.set(c * len, -s, 0, x, s * len, c, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
    this.mesh.setMatrixAt(i, this.m);
  }
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export interface MagnusScene {
  setParams(p: MagnusParams): void;
  setFocus(ids: string[]): void;
  setLabelsOn(on: boolean): void;
  setPlaying(playing: boolean): void;
  resetView(): void;
  /** Restarts the animation state (spin ramps from zero, particles re-seeded). */
  resetAnimation(): void;
  onState(cb: (s: MagnusState) => void): void;
}

export function createMagnusScene(container: HTMLElement): MagnusScene {
  const viewer = new Viewer({
    container,
    background: COLORS.bg,
    cameraPosition: new Vector3(6.2, 3.4, 19.5),
    target: new Vector3(0.6, 0, 0),
    fov: 40,
    fitAspect: 1.25,
  });
  const { scene } = viewer;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  let params: MagnusParams = {
    rpm: MAGNUS.rpm.default,
    airspeed: MAGNUS.airspeed.default,
    spinOn: false,
    direction: 'cw',
    pressureMap: false,
    pressureArrows: false,
  };
  let playing = true;
  let omega = 0; // current signed spin, rad/s (ramps toward the target)
  let rotorAngle = 0;
  let state = stateFromOmega(0, params.airspeed);
  let stateListener: ((s: MagnusState) => void) | null = null;

  // ---------- Environment ----------
  const grid = new GridHelper(44, 44, 0xc9c4b8, 0xdcd8ce);
  grid.position.y = -6.2;
  scene.add(grid);

  // ---------- Cylinder body (pressure-coloured, does not rotate) ----------
  const bodyGeo = new CylinderGeometry(1, 1, LENGTH, 120, 1, true).rotateX(Math.PI / 2);
  const bodyPos = bodyGeo.getAttribute('position');
  const bodyColors = new BufferAttribute(new Float32Array(bodyPos.count * 3), 3);
  bodyGeo.setAttribute('color', bodyColors);
  const bodyMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.05,
    emissive: COLORS.accent,
    emissiveIntensity: 0,
  });
  const body = new Mesh(bodyGeo, bodyMat);
  scene.add(body);

  // ---------- Rotor details that DO rotate (stripes + end caps with spokes) ----------
  const rotor = new Group();
  const stripeMat = new MeshStandardMaterial({ color: COLORS.ink, roughness: 0.6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const stripe = new Mesh(new BoxGeometry(0.06, 0.06, LENGTH + 0.01), stripeMat);
    stripe.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0);
    stripe.rotation.z = a;
    rotor.add(stripe);
  }
  const capMat = new MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.4, metalness: 0.2, side: DoubleSide });
  for (const z of [-HALF, HALF]) {
    const cap = new Mesh(new CircleGeometry(1, 64), capMat);
    cap.position.z = z;
    rotor.add(cap);
    for (let i = 0; i < 3; i++) {
      const spoke = new Mesh(new BoxGeometry(1.9, 0.12, 0.04), stripeMat);
      spoke.position.z = z + (z > 0 ? 0.02 : -0.02);
      spoke.rotation.z = (i / 3) * Math.PI;
      rotor.add(spoke);
    }
  }
  scene.add(rotor);

  // ---------- Rotation direction arrow (front end) ----------
  const rotArrow = new Group();
  const rotMat = new MeshStandardMaterial({ color: COLORS.accent, roughness: 0.4, emissive: COLORS.accent, emissiveIntensity: 0.2, side: DoubleSide });
  const arc = 1.4 * Math.PI;
  const start = 0.35 * Math.PI;
  const torus = new Mesh(new TorusGeometry(1.4, 0.06, 8, 64, arc), rotMat);
  torus.rotation.z = start;
  const cone = new Mesh(new ConeGeometry(0.17, 0.42, 16), rotMat);
  const endA = start + arc;
  cone.position.set(Math.cos(endA) * 1.4, Math.sin(endA) * 1.4, 0);
  cone.rotation.z = endA; // cone +y now points along the counter-clockwise tangent
  rotArrow.add(torus, cone);
  rotArrow.position.z = HALF + 0.12;
  scene.add(rotArrow);

  // ---------- Boundary layer: thin shell + particles that turn with the surface ----------
  const blMat = new MeshBasicMaterial({ color: COLORS.boundary, transparent: true, opacity: 0.12, depthWrite: false, side: DoubleSide });
  const blShell = new Mesh(new CylinderGeometry(1 + BL_THICK, 1 + BL_THICK, LENGTH - 0.1, 72, 1, true).rotateX(Math.PI / 2), blMat);
  scene.add(blShell);
  const BL_COUNT = coarse ? 160 : 260;
  const bl = new Streaks(BL_COUNT, 0.035);
  const blR = new Float32Array(BL_COUNT);
  const blA = new Float32Array(BL_COUNT);
  const blZ = new Float32Array(BL_COUNT);
  for (let i = 0; i < BL_COUNT; i++) {
    blR[i] = 1.03 + Math.random() * (BL_THICK - 0.03);
    blA[i] = Math.random() * Math.PI * 2;
    blZ[i] = (Math.random() * 2 - 1) * (HALF - 0.3);
    bl.mesh.setColorAt(i, tmpColor.setHex(COLORS.boundary));
  }
  scene.add(bl.mesh);

  // ---------- Air particles ----------
  // Like smoke rakes in a wind tunnel: particles start from fixed heights (lanes) on three
  // planes along the span, so each lane draws one streamline.
  const LANES = 18;
  const LANE_GAP = (2 * Y_SPAN) / LANES;
  const PLANES = [-2.4, 0, 2.4];
  const PER_STREAM = coarse ? 14 : 22;
  const N = LANES * PLANES.length * PER_STREAM;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const flow = new Streaks(N, 0.045);
  const spawn = (i: number, anywhere: boolean) => {
    const lane = i % LANES;
    const plane = Math.floor(i / LANES) % PLANES.length;
    const y0 = -Y_SPAN + LANE_GAP * (lane + 0.5);
    pz[i] = PLANES[plane];
    if (!anywhere) {
      px[i] = X_MIN + Math.random() * 0.4;
      py[i] = y0;
      return;
    }
    // Initial fill: start upstream and let the particle travel a random time,
    // so the screen is full at once and particles already follow the streamlines.
    px[i] = X_MIN;
    py[i] = y0;
    const steps = Math.floor(Math.random() * 180);
    const sv: [number, number] = [0, 0];
    for (let s = 0; s < steps; s++) {
      velocityAt(px[i], py[i], 0, sv);
      px[i] += sv[0] * 0.13;
      py[i] += sv[1] * 0.13;
      if (px[i] > X_MAX || px[i] * px[i] + py[i] * py[i] < 1.05) {
        px[i] = X_MIN + Math.random() * (X_MAX - X_MIN) * 0.4;
        py[i] = y0;
        break;
      }
    }
  };
  for (let i = 0; i < N; i++) spawn(i, true);
  scene.add(flow.mesh);

  // ---------- Pressure field slice on the back wall ----------
  const slice = new Mesh(
    new RingGeometry(1, 5.6, 128, 18),
    new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false }),
  );
  const slicePos = slice.geometry.getAttribute('position');
  const sliceColors = new BufferAttribute(new Float32Array(slicePos.count * 4), 4);
  slice.geometry.setAttribute('color', sliceColors);
  slice.position.z = -HALF - 0.03;
  scene.add(slice);

  // ---------- Surface pressure arrows ----------
  const ARROWS_AROUND = 24;
  const STATIONS = [-1.6, 1.6];
  const pArrowMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const pArrows = new ArrowField(ARROWS_AROUND * STATIONS.length, pArrowMat, 0.035);
  scene.add(pArrows.group);

  // ---------- Lift arrow, ΔP indicator, free-stream arrows ----------
  const lift = new Arrow(COLORS.lift, 0.13, 0.65);
  scene.add(lift.group);
  const LIFT_Z = HALF + 0.7;

  const dpUp = new Arrow(COLORS.ink, 0.045, 0.28);
  const dpDown = new Arrow(COLORS.ink, 0.045, 0.28);
  scene.add(dpUp.group, dpDown.group);
  const DP_X = -1.85;

  const fsArrows = [-3, 0, 3].map((y) => {
    const a = new Arrow(COLORS.freeStream, 0.08, 0.45);
    a.group.userData.y = y;
    scene.add(a.group);
    return a;
  });

  // ---------- Deflected wake band ----------
  const wakeMat = new MeshBasicMaterial({ color: COLORS.wake, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide });
  const wake = new Mesh<BufferGeometry, MeshBasicMaterial>(new BoxGeometry(0.01, 0.01, 0.01), wakeMat);
  scene.add(wake);
  let wakeDelta = NaN;
  const rebuildWake = (delta: number) => {
    if (Math.abs(delta - wakeDelta) < 0.004) return;
    wakeDelta = delta;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = 1.1 + (i / 24) * 9.5;
      pts.push(new Vector3(x, wakeCentre(x, delta), 0));
    }
    wake.geometry.dispose();
    wake.geometry = new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.6, 14, false);
    wake.scale.set(1, 1, 4); // flatten into a band along the span
  };

  // ---------- Placards ----------
  const placards = new PlacardSet();
  scene.add(placards.group);
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  placards.add(new Placard('freestream', 'Free stream airflow (V∞)', v(-7.6, 3, 0), v(0.3, 1.6, 0)));
  placards.add(new Placard('cylinder', 'Rotating cylinder', v(-0.99, -0.99, HALF + 0.12), v(-1.6, -2.6, 0)));
  placards.add(new Placard('boundary', 'Boundary layer (air pulled by the surface)', v(0.76, 0.9, HALF - 0.6), v(3.4, 1.3, 0)));
  const pFast = placards.add(new Placard('fastSide', 'High velocity / low pressure side', v(-0.3, 1.5, 1.5), v(0.7, 3.1, 0)));
  const pSlow = placards.add(new Placard('slowSide', 'Low velocity / high pressure side', v(-0.3, -1.5, 1.5), v(0.7, -3.1, 0)));
  const pDp = placards.add(new Placard('deltaP', 'Pressure difference (ΔP)', v(DP_X, 0, HALF + 0.35), v(-2.0, 0.2, 0)));
  const pLift = placards.add(new Placard('lift', 'Lift force (Magnus force)', v(0, 2, LIFT_Z), v(-0.6, 0, 0)));
  const pWake = placards.add(new Placard('wake', 'Deflected wake (downwash)', v(5, -1, 0), v(-1.2, -2.6, 0)));
  placards.refresh();

  // ---------- Focus (highlight) ----------
  let focus: string[] = [];
  const pulseTargets: Record<string, { mats: Material[]; kind: 'emissive' | 'opacity'; base: number }[]> = {
    freestream: fsArrows.map((a) => ({ mats: [a.material], kind: 'emissive' as const, base: 0.15 })),
    cylinder: [
      { mats: [bodyMat], kind: 'emissive', base: 0 },
      { mats: [rotMat], kind: 'emissive', base: 0.2 },
    ],
    boundary: [{ mats: [blMat], kind: 'opacity', base: 0.12 }],
    deltaP: [{ mats: [dpUp.material, dpDown.material], kind: 'emissive', base: 0.15 }],
    lift: [{ mats: [lift.material], kind: 'emissive', base: 0.15 }],
    wake: [{ mats: [wakeMat], kind: 'opacity', base: 0.07 }],
  };
  const applyPulse = (t: number) => {
    const p = 0.5 + 0.5 * Math.sin(t * 4);
    for (const [id, groups] of Object.entries(pulseTargets)) {
      const on = focus.includes(id);
      for (const g of groups) {
        for (const m of g.mats) {
          if (g.kind === 'emissive') {
            const sm = m as MeshStandardMaterial;
            sm.emissiveIntensity = on ? g.base + 0.25 + 0.35 * p : g.base;
          } else {
            (m as MeshBasicMaterial).opacity = on ? g.base * (1.6 + 1.4 * p) : g.base;
          }
        }
      }
    }
  };

  // ---------- Per-frame updates ----------
  const vel: [number, number] = [0, 0];
  const vel2: [number, number] = [0, 0];
  const inkColor = new Color(COLORS.inkSoft);
  const neutral = new Color(0xc9ced6);

  /** Velocity incl. the visual wake model (non-dimensional). */
  const flowVel = (x: number, y: number, k: number, delta: number, out: [number, number]) => {
    velocityAt(x, y, k, out);
    if (x > 0.3 && delta !== 0) {
      const w = smooth(0.3, 3.5, x) * Math.exp(-(((y - wakeCentre(x, delta)) / 2.4) ** 2));
      out[1] += Math.sin(delta) * w;
    }
    return out;
  };

  const updateBodyColors = (k: number, map: boolean) => {
    for (let i = 0; i < bodyPos.count; i++) {
      if (map) {
        const th = Math.atan2(bodyPos.getY(i), bodyPos.getX(i));
        cpToColor(cpSurface(th, k), tmpColor);
      } else tmpColor.copy(neutral);
      bodyColors.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    }
    bodyColors.needsUpdate = true;
  };

  const updateSlice = (k: number) => {
    for (let i = 0; i < slicePos.count; i++) {
      const x = slicePos.getX(i);
      const y = slicePos.getY(i);
      const r = Math.hypot(x, y);
      velocityAt(x * 1.0001, y * 1.0001, k, vel);
      cpToColor(1 - (vel[0] ** 2 + vel[1] ** 2), tmpColor);
      const alpha = 0.9 * (1 - smooth(2.2, 5.6, r));
      sliceColors.setXYZW(i, tmpColor.r, tmpColor.g, tmpColor.b, alpha);
    }
    sliceColors.needsUpdate = true;
  };

  const from = new Vector3();
  const to = new Vector3();
  const updatePressureArrows = (s: MagnusState) => {
    const { pressureArrowPerPa, pressureArrowMax } = MAGNUS.draw;
    let i = 0;
    for (const z of STATIONS) {
      for (let j = 0; j < ARROWS_AROUND; j++) {
        const th = ((j + 0.5) / ARROWS_AROUND) * Math.PI * 2;
        const cp = cpSurface(th, s.k);
        const dp = s.q * cp; // gauge pressure p − p∞, Pa
        const len = Math.min(Math.abs(dp) * pressureArrowPerPa, pressureArrowMax);
        const nx = Math.cos(th);
        const ny = Math.sin(th);
        const surf = 1.02;
        if (dp >= 0) {
          // Pressure above free stream pushes INTO the surface.
          from.set(nx * (surf + len), ny * (surf + len), z);
          to.set(nx * surf, ny * surf, z);
        } else {
          // Suction pulls the surface OUTWARD.
          from.set(nx * surf, ny * surf, z);
          to.set(nx * (surf + len), ny * (surf + len), z);
        }
        pArrows.set(i++, from, to, cpToColor(cp, tmpColor));
      }
    }
    pArrows.commit();
  };

  let lastKey = '';
  let lastLiftSign = 0;
  const up = new Vector3(0, 1, 0);
  const down = new Vector3(0, -1, 0);
  const right = new Vector3(1, 0, 0);

  const updateStatic = (s: MagnusState, delta: number) => {
    const key = `${s.k.toFixed(3)}|${s.q.toFixed(1)}|${params.pressureMap}|${params.pressureArrows}`;
    const spinning = Math.abs(s.k) > 0.01;
    if (key !== lastKey) {
      lastKey = key;
      updateBodyColors(s.k, params.pressureMap);
      slice.visible = params.pressureMap;
      if (params.pressureMap) updateSlice(s.k);
      pArrows.group.visible = params.pressureArrows;
      if (params.pressureArrows) updatePressureArrows(s);
      rebuildWake(delta);
    }

    // Lift arrow (to scale) and its placard
    const { liftArrowPerNm, liftArrowMax } = MAGNUS.draw;
    const len = Math.min(Math.abs(s.liftPerSpan) * liftArrowPerNm, liftArrowMax);
    const sign = s.liftPerSpan >= 0 ? 1 : -1;
    lift.set(new Vector3(0, 0, LIFT_Z), sign > 0 ? up : down, len);
    pLift.setAnchor(new Vector3(0, sign * Math.max(len - 0.2, 0.3), LIFT_Z), new Vector3(-0.6, 0, 0));

    // ΔP double arrow between the two sides
    const dpLen = spinning ? 1.25 : 0;
    dpUp.set(new Vector3(DP_X, 0, HALF + 0.35), up, dpLen);
    dpDown.set(new Vector3(DP_X, 0, HALF + 0.35), down, dpLen);

    // Free-stream arrows grow with airspeed
    for (const a of fsArrows) {
      a.set(new Vector3(-8.6, a.group.userData.y as number, 0), right, 1.2 + params.airspeed * 0.09);
    }

    // Rotation arrow: mirrored for clockwise
    rotArrow.visible = params.spinOn;
    rotArrow.scale.x = params.direction === 'cw' ? -1 : 1;

    // Wake band + boundary layer only when there is spin
    wake.visible = spinning;
    blShell.visible = Math.abs(omega) > 1;
    bl.mesh.visible = blShell.visible;

    // Placards that move with the lift direction
    if (sign !== lastLiftSign) {
      lastLiftSign = sign;
      const fastY = sign > 0 ? 1 : -1;
      pFast.setAnchor(new Vector3(-0.3, 1.5 * fastY, 1.5), new Vector3(0.7, 3.1 * fastY, 0));
      pSlow.setAnchor(new Vector3(-0.3, -1.5 * fastY, 1.5), new Vector3(0.7, -3.1 * fastY, 0));
    }
    pWake.setAnchor(new Vector3(5, wakeCentre(5, delta), 0), new Vector3(-1.2, -2.6 * sign, 0));

    const cyl = placards.get('cylinder');
    cyl.setText(
      params.spinOn
        ? `Rotating cylinder (${params.direction === 'cw' ? 'clockwise' : 'counter-clockwise'})`
        : 'Cylinder (not turning)',
    );
    for (const p of [pFast, pSlow, pDp, pLift, pWake]) p.setContextVisible(spinning);
    placards.get('boundary').setContextVisible(params.spinOn);
    placards.refresh();
  };

  let time = 0;
  let readoutTimer = 0;

  viewer.start((dtReal) => {
    time += dtReal;
    const dt = playing ? dtReal : 0;

    // Spin ramps toward its target (spin-up / spin-down / reversal)
    const target = params.spinOn ? (params.direction === 'cw' ? 1 : -1) * rpmToRadPerSec(params.rpm) : 0;
    omega += (target - omega) * (1 - Math.exp(-dt / MAGNUS.spinUpTime));
    if (Math.abs(target - omega) < 0.05) omega = target;
    state = stateFromOmega(omega, params.airspeed);
    const delta = wakeAngle(state.k);

    updateStatic(state, delta);
    applyPulse(time);

    // Visual (slow-motion) speeds in scene units per second
    const Uvis = params.airspeed / MAGNUS.radius / MAGNUS.slowMotion;
    const omegaVis = omega / MAGNUS.slowMotion;
    rotorAngle -= omegaVis * dt; // + omega = clockwise = negative z-rotation
    rotor.rotation.z = rotorAngle;

    // Boundary-layer particles turn with the surface (speed falls off across the layer)
    for (let i = 0; i < BL_COUNT; i++) {
      const f = 1 - 0.75 * ((blR[i] - 1) / BL_THICK);
      blA[i] -= omegaVis * f * dt;
      const c = Math.cos(blA[i]);
      const s = Math.sin(blA[i]);
      const dir = omega >= 0 ? 1 : -1;
      bl.set(i, blR[i] * c, blR[i] * s, blZ[i], s * dir, -c * dir, 0.1 + Math.abs(omegaVis) * 0.12);
    }
    bl.commit();

    // Air particles (midpoint integration)
    const k = state.k;
    const h = dt * Uvis;
    const map = params.pressureMap;
    for (let i = 0; i < N; i++) {
      let x = px[i];
      let y = py[i];
      if (h > 0) {
        flowVel(x, y, k, delta, vel);
        flowVel(x + vel[0] * h * 0.5, y + vel[1] * h * 0.5, k, delta, vel2);
        x += vel2[0] * h;
        y += vel2[1] * h;
        px[i] = x;
        py[i] = y;
        if (x > X_MAX || Math.abs(y) > Y_SPAN + 2 || x * x + y * y < 1.0) {
          spawn(i, false);
          x = px[i];
          y = py[i];
        }
      }
      flowVel(x, y, k, delta, vel);
      const sp2 = vel[0] * vel[0] + vel[1] * vel[1];
      flow.set(i, x, y, pz[i], vel[0], vel[1], 0.15 + Math.sqrt(sp2) * Uvis * 0.2);
      if (map) {
        velocityAt(x, y, k, vel2);
        cpToColor(1 - (vel2[0] ** 2 + vel2[1] ** 2), tmpColor);
        flow.mesh.setColorAt(i, tmpColor);
      } else flow.mesh.setColorAt(i, inkColor);
    }
    flow.commit();

    readoutTimer -= dtReal;
    if (readoutTimer <= 0 && stateListener) {
      readoutTimer = 0.1;
      stateListener(state);
    }
  });

  return {
    setParams(p) {
      params = { ...p };
      lastKey = '';
    },
    setFocus(ids) {
      focus = ids;
      placards.setFocus(ids);
    },
    setLabelsOn(on) {
      placards.setLabelsOn(on);
    },
    setPlaying(p) {
      playing = p;
    },
    resetView() {
      viewer.resetView();
    },
    resetAnimation() {
      omega = 0;
      rotorAngle = 0;
      for (let i = 0; i < N; i++) spawn(i, true);
      lastKey = '';
    },
    onState(cb) {
      stateListener = cb;
    },
  };
}

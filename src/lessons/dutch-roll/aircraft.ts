/**
 * Procedural A320-LIKE airliner (no logo, no airline livery).
 * Low swept wing with dihedral, two engines under the wings, conventional tail.
 * The rudder and the ailerons are separate parts that turn about their hinge lines.
 *
 * Local axes: −z = forward (nose), +x = right wing, +y = up. Units: metres.
 * Main sizes follow the A320 (span 34.1 m, length 37.6 m, height 11.8 m) [D1 in config].
 */
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LatheGeometry,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { DUTCH_ROLL } from '../../config/dutchRoll';

const DEG = Math.PI / 180;

interface Section {
  /** Leading-edge point. */
  le: Vector3;
  chord: number;
  thick: number;
}

/**
 * Builds a lifting surface between two sections with a simple 6-point airfoil.
 * `aft` is the chord direction (from leading to trailing edge); `up` is the thickness direction.
 */
function panel(a: Section, b: Section, aft = new Vector3(0, 0, 1), up = new Vector3(0, 1, 0)): BufferGeometry {
  // airfoil points: [chord fraction, thickness fraction]
  const foil: [number, number][] = [
    [0, 0],
    [0.12, 0.42],
    [0.45, 0.5],
    [1, 0],
    [0.45, -0.45],
    [0.12, -0.38],
  ];
  const ring = (s: Section) =>
    foil.map(([c, t]) => s.le.clone().addScaledVector(aft, c * s.chord).addScaledVector(up, t * s.thick));
  const A = ring(a);
  const B = ring(b);
  const pos: number[] = [];
  const tri = (p: Vector3, q: Vector3, r: Vector3) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  const n = foil.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(A[i], B[i], B[j]);
    tri(A[i], B[j], A[j]);
  }
  for (let i = 1; i < n - 1; i++) {
    tri(A[0], A[i + 1], A[i]);
    tri(B[0], B[i], B[i + 1]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface AircraftModel {
  group: Group;
  /** Turns the rudder (rad, + = trailing edge right). */
  setRudder(rad: number): void;
  /** Turns the ailerons (rad, + = right aileron up). Kept for later lessons. */
  setAilerons(rad: number): void;
  /** Materials per part, for highlighting. */
  parts: Record<string, MeshStandardMaterial[]>;
  /** Useful points in local coordinates (placard anchors etc.). */
  points: Record<string, Vector3>;
  /** Pilot eye point (captain seat), local coordinates. */
  eye: Vector3;
  /** Guide lines showing the dihedral angle. */
  dihedralGuide: Group;
  /** Dashed rudder hinge line. */
  hingeLine: Line;
}

export function createAircraft(): AircraftModel {
  const group = new Group();
  const paint = () => new MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.42, metalness: 0.05, side: DoubleSide });
  const mats = {
    fuselage: new MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.42, metalness: 0.05, side: FrontSide }),
    belly: new MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.5, side: FrontSide }),
    wing: paint(),
    tailplane: paint(),
    fin: paint(),
    rudder: new MeshStandardMaterial({ color: 0xdde1e7, roughness: 0.45, side: DoubleSide }),
    aileron: new MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.5, side: DoubleSide }),
    engine: new MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.35, metalness: 0.25, side: DoubleSide }),
    dark: new MeshStandardMaterial({ color: 0x1b2430, roughness: 0.3, metalness: 0.2, side: DoubleSide }),
    window: new MeshStandardMaterial({ color: 0x24344a, roughness: 0.15, metalness: 0.6, side: DoubleSide }),
  };
  for (const m of Object.values(mats)) {
    m.emissive.setHex(0xd9822b);
    m.emissiveIntensity = 0;
  }

  // ---------- Fuselage ----------
  // [axial position (+ = toward nose), radius]
  const R = 1.98;
  const profile: [number, number][] = [
    [17.6, 0.0],
    [17.45, 0.5],
    [17.1, 0.95],
    [16.5, 1.35],
    [15.6, 1.68],
    [14.4, 1.9],
    [13.0, R],
    [-9.5, R],
    [-12.0, 1.82],
    [-14.5, 1.45],
    [-17.0, 0.95],
    [-19.4, 0.42],
    [-20.0, 0.12],
  ];
  const lathe = new LatheGeometry(
    profile.map(([a, r]) => new Vector2(r, a)).reverse(),
    40,
  ).rotateX(-Math.PI / 2);
  const fuselage = new Mesh(lathe, mats.fuselage);
  group.add(fuselage);
  // Grey belly fairing (a slightly larger lower half under the wing box)
  const belly = new Mesh(
    new CylinderGeometry(R + 0.03, R + 0.03, 12, 24, 1, true, -Math.PI * 0.3, Math.PI * 0.6).rotateX(Math.PI / 2),
    mats.belly,
  );
  belly.position.set(0, 0, 0.5);
  group.add(belly);

  // Cockpit windows: two slanted dark panels
  for (const side of [-1, 1]) {
    const w = new Mesh(panel(
      { le: new Vector3(0.05 * side, 0.85, -16.2), chord: 1.1, thick: 0.02 },
      { le: new Vector3(1.0 * side, 0.7, -15.9), chord: 1.0, thick: 0.02 },
    ), mats.window);
    group.add(w);
  }
  // Cabin window line
  for (const side of [-1, 1]) {
    const strip = new Mesh(new CylinderGeometry(0.06, 0.06, 26, 6).rotateX(Math.PI / 2), mats.window);
    strip.position.set(side * (R - 0.02), 0.55, -1.5);
    group.add(strip);
  }

  // ---------- Wings (low, swept, with dihedral) ----------
  const { span, dihedralDeg } = DUTCH_ROLL.geometry;
  const half = span / 2;
  const dih = Math.tan(dihedralDeg * DEG);
  const rootY = -1.05;
  const leSweep = Math.tan(27 * DEG); // leading-edge sweep ≈ 27° for 25° at quarter chord
  const wingSection = (x: number) => {
    const s = x / half;
    return {
      le: new Vector3(x, rootY + x * dih, -3.6 + x * leSweep),
      chord: lerp(6.2, 1.5, s),
      thick: lerp(0.8, 0.2, s),
    };
  };
  const ailerons: Group[] = [];
  for (const side of [1, -1]) {
    const wing = new Group();
    wing.add(new Mesh(panel(wingSection(0), wingSection(half)), mats.wing));
    // sharklet
    const tip = wingSection(half);
    wing.add(
      new Mesh(
        panel(
          { le: tip.le.clone().add(new Vector3(-0.05, 0.05, 0.1)), chord: 1.35, thick: 0.14 },
          { le: tip.le.clone().add(new Vector3(0.55, 2.3, 1.3)), chord: 0.45, thick: 0.06 },
          new Vector3(0, 0, 1),
          new Vector3(1, 0, 0),
        ),
        mats.wing,
      ),
    );
    // aileron: outboard trailing edge, 72–94 % span, aft 22 % chord
    const s0 = wingSection(half * 0.72);
    const s1 = wingSection(half * 0.94);
    const h0 = s0.le.clone().add(new Vector3(0, 0, s0.chord * 0.78));
    const h1 = s1.le.clone().add(new Vector3(0, 0, s1.chord * 0.78));
    const pivot = new Group();
    pivot.position.copy(h0);
    pivot.userData.axis = h1.clone().sub(h0).normalize();
    const ail = new Mesh(
      panel(
        { le: new Vector3(0, 0.02, 0), chord: s0.chord * 0.23, thick: s0.thick * 0.35 },
        { le: h1.clone().sub(h0).add(new Vector3(0, 0.02, 0)), chord: s1.chord * 0.23, thick: s1.thick * 0.35 },
      ),
      mats.aileron,
    );
    pivot.add(ail);
    wing.add(pivot);
    ailerons.push(pivot);

    // engine + pylon
    const ex = 5.75;
    const ws = wingSection(ex);
    const nacelleProfile: [number, number][] = [
      [0, 0.92],
      [0.25, 1.02],
      [1.2, 1.06],
      [3.0, 0.98],
      [4.2, 0.72],
      [4.6, 0.45],
    ];
    const nac = new Mesh(
      new LatheGeometry(nacelleProfile.map(([a, r]) => new Vector2(r, a)), 28).rotateX(Math.PI / 2),
      mats.engine,
    );
    const ez = ws.le.z - 3.2;
    nac.position.set(ex, ws.le.y - 1.55, ez);
    wing.add(nac);
    const inlet = new Mesh(new CylinderGeometry(0.9, 0.9, 0.1, 28).rotateX(Math.PI / 2), mats.dark);
    inlet.position.set(ex, ws.le.y - 1.55, ez + 0.3);
    wing.add(inlet);
    const pylon = new Mesh(
      panel(
        { le: new Vector3(ex, ws.le.y - 0.75, ez + 0.6), chord: 4.6, thick: 0.35 },
        { le: new Vector3(ex, ws.le.y - 0.1, ez + 2.2), chord: 3.6, thick: 0.35 },
        new Vector3(0, 0, 1),
        new Vector3(1, 0, 0),
      ),
      mats.engine,
    );
    wing.add(pylon);

    if (side < 0) wing.scale.x = -1;
    group.add(wing);
  }

  // ---------- Horizontal tailplane ----------
  for (const side of [1, -1]) {
    const htp = new Mesh(
      panel(
        { le: new Vector3(0, 0.55, 13.6), chord: 4.0, thick: 0.38 },
        { le: new Vector3(6.2, 0.55 + 6.2 * Math.tan(6 * DEG), 13.6 + 6.2 * Math.tan(32 * DEG)), chord: 1.5, thick: 0.13 },
      ),
      mats.tailplane,
    );
    if (side < 0) htp.scale.x = -1;
    group.add(htp);
  }

  // ---------- Fin and rudder ----------
  const finRootY = 1.35;
  const finH = 5.9;
  const finSweep = Math.tan(38 * DEG);
  const finSection = (h: number) => ({
    le: new Vector3(0, finRootY + h, 11.2 + h * finSweep),
    chord: lerp(5.8, 2.3, h / finH),
    thick: lerp(0.55, 0.18, h / finH),
  });
  const HINGE = 0.68;
  const fixedPart = (h: number) => {
    const s = finSection(h);
    return { ...s, chord: s.chord * HINGE };
  };
  const vAft = new Vector3(0, 0, 1);
  const vSide = new Vector3(1, 0, 0);
  group.add(new Mesh(panel(fixedPart(0), fixedPart(finH), vAft, vSide), mats.fin));

  const r0 = 0.35;
  const r1 = finH - 0.25;
  const hinge0 = finSection(r0).le.clone().addScaledVector(vAft, finSection(r0).chord * HINGE);
  const hinge1 = finSection(r1).le.clone().addScaledVector(vAft, finSection(r1).chord * HINGE);
  const hingeAxis = hinge1.clone().sub(hinge0).normalize();
  const rudderPivot = new Group();
  rudderPivot.position.copy(hinge0);
  const rs = (h: number, hp: Vector3) => {
    const s = finSection(h);
    return { le: hp.clone().sub(hinge0), chord: s.chord * (1 - HINGE), thick: s.thick * 0.55 };
  };
  rudderPivot.add(new Mesh(panel(rs(r0, hinge0), rs(r1, hinge1), vAft, vSide), mats.rudder));
  group.add(rudderPivot);

  const hingeGeo = new BufferGeometry().setFromPoints([
    hinge0.clone().addScaledVector(hingeAxis, -0.6),
    hinge1.clone().addScaledVector(hingeAxis, 0.6),
  ]);
  const hingeLine = new Line(hingeGeo, new LineDashedMaterial({ color: 0xd9822b, dashSize: 0.35, gapSize: 0.22 }));
  hingeLine.computeLineDistances();
  hingeLine.position.x = 0.32;
  hingeLine.visible = false;
  group.add(hingeLine);

  // ---------- Dihedral guide (horizontal reference + wing line) ----------
  const dihedralGuide = new Group();
  const guideMat = new LineDashedMaterial({ color: 0x1d2733, dashSize: 0.5, gapSize: 0.3, depthTest: false, transparent: true });
  const wingLineMat = new LineDashedMaterial({ color: 0xd9822b, dashSize: 10, gapSize: 0, depthTest: false, transparent: true });
  for (const side of [1, -1]) {
    const z = 0.5;
    const ref = new Line(new BufferGeometry().setFromPoints([new Vector3(side * 1.5, rootY, z), new Vector3(side * 17, rootY, z)]), guideMat);
    ref.computeLineDistances();
    const wl = new Line(
      new BufferGeometry().setFromPoints([new Vector3(side * 1.5, rootY + 1.5 * dih, z), new Vector3(side * 17, rootY + 17 * dih, z)]),
      wingLineMat,
    );
    wl.computeLineDistances();
    ref.renderOrder = wl.renderOrder = 9;
    dihedralGuide.add(ref, wl);
  }
  dihedralGuide.visible = false;
  group.add(dihedralGuide);

  const q = new Quaternion();
  const ailQ = new Quaternion();
  return {
    group,
    setRudder(rad) {
      q.setFromAxisAngle(hingeAxis, rad);
      rudderPivot.quaternion.copy(q);
    },
    setAilerons(rad) {
      ailerons.forEach((p, i) => {
        ailQ.setFromAxisAngle(p.userData.axis as Vector3, i === 0 ? -rad : rad);
        p.quaternion.copy(ailQ);
      });
    },
    parts: {
      fin: [mats.fin],
      rudder: [mats.rudder],
      wing: [mats.wing],
      dihedral: [mats.wing],
      aileron: [mats.aileron],
      engine: [mats.engine],
    },
    points: {
      nose: new Vector3(0, 0.3, -17.4),
      finMid: finSection(finH * 0.55).le.clone().add(new Vector3(0, 0, 1.2)),
      rudderMid: hinge0.clone().lerp(hinge1, 0.5).add(new Vector3(0, 0, 0.6)),
      rightWingMid: wingSection(half * 0.55).le.clone().add(new Vector3(0, 0.25, 1.4)),
      leftWingMid: wingSection(half * 0.55).le.clone().add(new Vector3(0, 0.25, 1.4)).multiply(new Vector3(-1, 1, 1)),
      rightWingTip: wingSection(half).le.clone().add(new Vector3(0, 0.1, 0.7)),
      leftWingTip: wingSection(half).le.clone().add(new Vector3(0, 0.1, 0.7)).multiply(new Vector3(-1, 1, 1)),
      rightAileron: wingSection(half * 0.83).le.clone().add(new Vector3(0, 0.15, wingSection(half * 0.83).chord * 0.9)),
      leftEngine: new Vector3(-5.75, wingSection(5.75).le.y - 1.55, wingSection(5.75).le.z - 2.2),
      dihedralLeft: new Vector3(-12, rootY + 12 * dih, 0.5),
    },
    eye: new Vector3(-0.55, 0.95, -15.2),
    dihedralGuide,
    hingeLine,
  };
}

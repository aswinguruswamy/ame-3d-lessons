/**
 * Lesson 2 3D scene: A320-like airliner above a cloud deck, with outside, cockpit and split views.
 * Loaded lazily with Three.js. The physics runs in main.ts; this file only draws it.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { DUTCH_ROLL } from '../../config/dutchRoll';
import { Arrow } from '../../shared/arrows';
import { Placard, PlacardSet } from '../../shared/placards';
import { Viewer } from '../../shared/viewer';
import { createAircraft } from './aircraft';

const DEG = Math.PI / 180;
/** Demo swing angles (steps 2–3). Exaggerated for demonstration; see the on-screen note. */
const DEMO_YAW = 8 * DEG;
const DEMO_ROLL = 10 * DEG;
/** Layer 1: seen only from outside. Layer 2: seen only from the cockpit. */
const OUTSIDE = 1;
const COCKPIT = 2;

export type ViewMode = 'outside' | 'cockpit' | 'split';
export type SceneMode = 'live' | 'weathervane' | 'dihedral';

export interface Pose {
  phi: number;
  psi: number;
  beta: number;
  dr: number;
}

export interface DRSceneHooks {
  /** Advance the physics by dt seconds (0 when paused). */
  tick(dt: number): void;
  /** Current attitude and rudder from the physics. */
  pose(): Pose;
}

export interface DutchRollScene {
  setMode(m: SceneMode): void;
  setView(v: ViewMode): void;
  setFocus(ids: string[]): void;
  setLabelsOn(on: boolean): void;
  setPlaying(p: boolean): void;
  setAirspeed(v: number): void;
  resetView(): void;
  clearTrails(): void;
}

function cloudTexture(size: number, blobs: number, base: string | null, seed = 1, wrap = true) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  if (base) {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < blobs; i++) {
    // tiling texture: blobs anywhere (wrapped); single cloud: blobs kept inside a soft dome
    const x = wrap ? rnd() * size : size * (0.25 + 0.5 * rnd());
    const y = wrap ? rnd() * size : size * (0.35 + 0.45 * rnd());
    const r = (wrap ? 0.04 + rnd() * 0.12 : 0.08 + rnd() * 0.12) * size;
    const copies = wrap ? [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] : [[0, 0]];
    for (const [dx, dy] of copies) {
      const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createDutchRollScene(container: HTMLElement, hooks: DRSceneHooks): DutchRollScene {
  const viewer = new Viewer({
    container,
    cameraPosition: new Vector3(-58, 15, -16), // = HOMES.live (3/4 side view, left side, slightly ahead)
    target: new Vector3(0, 0.5, 1),
    fov: 40,
    fitAspect: 1.3,
  });
  const { scene, renderer, labelRenderer, controls } = viewer;
  const outsideCam = viewer.camera;
  outsideCam.far = 30000;
  outsideCam.updateProjectionMatrix();
  outsideCam.layers.enable(OUTSIDE);
  controls.minDistance = 12;
  controls.maxDistance = 140;

  // ---------- Sky, fog, cloud deck, distant towers ----------
  const HORIZON = new Color(0xdfe8f0);
  scene.fog = new Fog(HORIZON, 2500, 16000);
  const sky = new Mesh(
    new SphereGeometry(20000, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new Color(0x3d6fb0) }, horizon: { value: HORIZON }, below: { value: new Color(0xc7d3dd) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h*2.2,1.0), 0.7)) : mix(horizon, below, min(-h*6.0,1.0)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const deckTex = cloudTexture(512, 70, '#c9d6e2', 7);
  deckTex.wrapS = deckTex.wrapT = RepeatWrapping;
  deckTex.repeat.set(40, 40);
  const deck = new Mesh(new PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: deckTex }));
  deck.position.y = -900;
  scene.add(deck);
  const TILE = 60000 / 40;

  const towerTex = cloudTexture(256, 26, null, 3, false);
  for (const [x, y, sx] of [
    [-5200, 0, 2200],
    [-1700, 0, 1600],
    [900, 0, 1300],
    [3600, 0, 2000],
    [6800, 0, 1700],
  ]) {
    const sp = new Sprite(new SpriteMaterial({ map: towerTex, color: 0xffffff, fog: true, depthWrite: false }));
    sp.position.set(x, -900 + sx * 0.22 + y * 0, -9000);
    sp.scale.set(sx, sx * 0.6, 1);
    scene.add(sp);
  }

  // ---------- Aircraft ----------
  const ac = createAircraft();
  const attitude = new Group();
  attitude.rotation.order = 'YXZ';
  attitude.add(ac.group);
  scene.add(attitude);
  // Exterior-only parts: the cockpit camera sits inside the nose.
  ac.group.traverse((o) => {
    o.layers.set(OUTSIDE);
  });

  // ---------- Cockpit ----------
  const cockpitCam = new PerspectiveCamera(62, 1, 0.05, 30000);
  cockpitCam.position.copy(ac.eye);
  cockpitCam.rotation.x = -4 * DEG;
  cockpitCam.layers.set(0);
  cockpitCam.layers.enable(COCKPIT);
  ac.group.add(cockpitCam);
  const cockpit = new Group();
  const shieldMat = new MeshStandardMaterial({ color: 0x1f262f, roughness: 0.85 });
  const panelMat = new MeshStandardMaterial({ color: 0x3a434e, roughness: 0.9 });
  const glare = new Mesh(new BoxGeometry(3.6, 0.12, 0.8), shieldMat);
  glare.position.set(-0.1, ac.eye.y - 0.5, ac.eye.z - 1.25);
  glare.rotation.x = 0.08;
  const lip = new Mesh(new BoxGeometry(3.6, 0.5, 0.08), shieldMat);
  lip.position.set(-0.1, ac.eye.y - 0.78, ac.eye.z - 0.86);
  const ipanel = new Mesh(new BoxGeometry(3.6, 1.2, 0.1), panelMat);
  ipanel.position.set(-0.1, ac.eye.y - 1.25, ac.eye.z - 1.4);
  const post = (x: number, rotZ: number) => {
    const m = new Mesh(new BoxGeometry(0.05, 1.3, 0.05), shieldMat);
    m.position.set(x, ac.eye.y + 0.12, ac.eye.z - 1.5);
    m.rotation.z = rotZ;
    return m;
  };
  const roof = new Mesh(new BoxGeometry(3.6, 0.1, 1.6), shieldMat);
  roof.position.set(-0.1, ac.eye.y + 0.8, ac.eye.z - 0.9);
  cockpit.add(glare, lip, ipanel, post(0.0, 0), post(-1.55, -0.25), post(1.35, 0.25), roof);
  // Fixed nose reference (like a flight-path "W"): the horizon moves, this does not.
  const wMat = new MeshBasicMaterial({ color: 0xffc23d, depthTest: false, toneMapped: false });
  const wSym = new Group();
  const wPts = [[-0.1, 0], [-0.045, 0], [-0.022, -0.028], [0, 0], [0.022, -0.028], [0.045, 0], [0.1, 0]];
  for (let i = 0; i < wPts.length - 1; i++) {
    const [x1, y1] = wPts[i];
    const [x2, y2] = wPts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const seg = new Mesh(new BoxGeometry(len + 0.004, 0.006, 0.001), wMat);
    seg.position.set((x1 + x2) / 2, (y1 + y2) / 2, -1);
    seg.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    seg.renderOrder = 20;
    wSym.add(seg);
  }
  wSym.rotation.x = 4 * DEG;
  cockpitCam.add(wSym);
  cockpit.traverse((o) => o.layers.set(COCKPIT));
  wSym.traverse((o) => o.layers.set(COCKPIT));
  ac.group.add(cockpit);

  // ---------- Wingtip trails ----------
  const TRAIL = 220;
  const TRAIL_SLOW = 4;
  const trailPos = [new Float32Array(TRAIL * 3), new Float32Array(TRAIL * 3)];
  const trails = trailPos.map((arr) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(arr, 3)); // shares `arr` (no copy)
    const l = new Line(g, new LineBasicMaterial({ color: 0x3f6fa6, transparent: true, opacity: 0.9, fog: false }));
    l.frustumCulled = false;
    l.layers.set(OUTSIDE);
    scene.add(l);
    return l;
  });
  let trailsFilled = false;
  const tipWorld = new Vector3();
  const updateTrails = (dt: number) => {
    // Trail points stay in the air, so they move aft at the airspeed. Drawn slowed (÷ TRAIL_SLOW)
    // so the Dutch roll wave (wavelength ≈ V·T ≈ 1.3 km) fits in the view.
    const vis = (airspeed / TRAIL_SLOW) * dt;
    const tips = [ac.points.rightWingTip, ac.points.leftWingTip];
    trails.forEach((line, k) => {
      const a = trailPos[k];
      tipWorld.copy(tips[k]);
      ac.group.localToWorld(tipWorld);
      if (!trailsFilled) {
        for (let i = 0; i < TRAIL; i++) {
          a[i * 3] = tipWorld.x;
          a[i * 3 + 1] = tipWorld.y;
          a[i * 3 + 2] = tipWorld.z + i * 1.0;
        }
      } else {
        for (let i = TRAIL - 1; i > 0; i--) {
          a[i * 3] = a[(i - 1) * 3];
          a[i * 3 + 1] = a[(i - 1) * 3 + 1];
          a[i * 3 + 2] = a[(i - 1) * 3 + 2] + vis;
        }
        a[0] = tipWorld.x;
        a[1] = tipWorld.y;
        a[2] = tipWorld.z;
      }
      (line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    });
    trailsFilled = true;
  };

  // ---------- Demo arrows ----------
  const wind = new Group();
  const windArrows = [-5, 0, 5].map((x) => {
    const a = new Arrow(0x2a7fd4, 0.22, 1.4);
    a.group.userData.x = x;
    wind.add(a.group);
    return a;
  });
  wind.traverse((o) => o.layers.set(OUTSIDE));
  scene.add(wind);

  // Velocity vector (flight path) from the nose, and a dashed line along the nose axis.
  // The angle between them is the sideslip β (true size, not exaggerated).
  const PATH_LEN = 10;
  const velArrow = new Arrow(0x7b4fc9, 0.12, 0.8);
  const noseAxis = new Line(
    new BufferGeometry().setFromPoints([ac.points.nose.clone(), ac.points.nose.clone().add(new Vector3(0, 0, -PATH_LEN))]),
    new LineDashedMaterial({ color: 0x1d2733, dashSize: 0.6, gapSize: 0.4 }),
  );
  noseAxis.computeLineDistances();
  for (const o of [velArrow.group, noseAxis]) {
    o.traverse((c) => c.layers.set(OUTSIDE));
    ac.group.add(o);
  }

  const finForce = new Arrow(0xd9822b, 0.2, 1.1);
  const liftR = new Arrow(0x1f8a4c, 0.2, 1.1);
  const liftL = new Arrow(0x1f8a4c, 0.2, 1.1);
  for (const a of [finForce, liftR, liftL]) {
    a.group.traverse((o) => o.layers.set(OUTSIDE));
    ac.group.add(a.group);
  }

  // ---------- Placards (move with the aircraft) ----------
  const P = ac.points;
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const placards = new PlacardSet();
  // Offsets use y (up) and z (aft) so they read well in the side view.
  const left = (p: Vector3) => p.clone().multiply(v(-1, 1, 1));
  placards.add(new Placard('fin', 'Vertical stabiliser (fin)', P.finMid, v(0, 5.5, -4)));
  placards.add(new Placard('rudder', 'Rudder (turns about its hinge line)', P.rudderMid, v(0, 4, 6)));
  placards.add(new Placard('wing', 'Swept wing (25°)', P.leftWingMid, v(0, -5, -5)));
  placards.add(new Placard('dihedral', 'Dihedral angle (≈5°)', P.dihedralLeft, v(0, 5, -6)));
  placards.add(new Placard('aileron', 'Aileron', left(P.rightAileron), v(0, -4, 6)));
  placards.add(new Placard('engine', 'Engine', P.leftEngine, v(0, -4.5, -6)));
  const pWind = placards.add(new Placard('wind', 'Relative wind', v(0, 2, -30), v(-6, 4, 0)));
  const pFinForce = placards.add(new Placard('finForce', 'Side force on the fin', P.finMid, v(6, 5, 0)));
  const pLift = placards.add(new Placard('wingLift', 'More lift on the low (upwind) wing', P.rightWingMid.clone().add(v(0, 4, 0)), v(4, 3, 0)));
  placards.add(new Placard('yaw', 'Yaw: the nose swings left and right', P.nose, v(0, 4.5, -3)));
  placards.add(new Placard('roll', 'Roll: the wings rock up and down', P.leftWingTip, v(0, 4.5, 5)));
  const pPath = placards.add(
    new Placard('flightPath', 'Flight path (velocity). Its angle to the nose is the sideslip β', P.nose.clone().add(v(0, 0, -9)), v(0, -4, -2)),
  );
  placards.group.traverse((o) => o.layers.set(OUTSIDE));
  ac.group.add(placards.group);

  // Camera start positions per mode: chase view, top view (yaw), rear view (roll)
  const HOMES: Record<SceneMode, [Vector3, Vector3]> = {
    live: [new Vector3(-58, 15, -16), new Vector3(0, 0.5, 1)],
    weathervane: [new Vector3(3, 88, 22), new Vector3(0, 0, -2)],
    dihedral: [new Vector3(0, 5, 56), new Vector3(0, 1.5, 0)],
  };

  // ---------- State ----------
  let mode: SceneMode = 'live';
  let view: ViewMode = 'outside';
  let playing = true;
  let focus: string[] = [];
  let airspeed: number = DUTCH_ROLL.sliders.airspeed.default;
  let demoT = 0;
  let time = 0;

  const refreshContext = () => {
    const demo = mode !== 'live';
    pWind.setContextVisible(demo);
    pFinForce.setContextVisible(mode === 'weathervane');
    pLift.setContextVisible(mode === 'dihedral');
    placards.get('yaw').setContextVisible(mode === 'live' && focus.includes('yaw'));
    placards.get('roll').setContextVisible(mode === 'live' && focus.includes('roll'));
    wind.visible = demo;
    finForce.group.visible = mode === 'weathervane';
    liftR.group.visible = liftL.group.visible = mode === 'dihedral';
    trails.forEach((t) => (t.visible = mode === 'live'));
    velArrow.group.visible = noseAxis.visible = mode === 'live';
    pPath.setContextVisible(mode === 'live' && focus.includes('flightPath'));
    ac.dihedralGuide.visible = focus.includes('dihedral');
    ac.hingeLine.visible = focus.includes('rudder');
    placards.refresh();
  };

  const applyPulse = () => {
    const p = 0.5 + 0.5 * Math.sin(time * 4);
    const lit = new Set<MeshStandardMaterial>();
    for (const id of focus) for (const m of ac.parts[id] ?? []) lit.add(m);
    for (const list of Object.values(ac.parts)) for (const m of list) m.emissiveIntensity = lit.has(m) ? 0.15 + 0.3 * p : 0;
  };

  /** Scripted poses for the two theory steps (visual only). */
  const demoPose = (t: number): Pose => {
    if (mode === 'weathervane') {
      const c = t % 7;
      const psi = c < 0.7 ? DEMO_YAW * (c / 0.7) : DEMO_YAW * Math.exp(-0.55 * (c - 0.7)) * Math.cos(1.25 * (c - 0.7));
      return { phi: 0, psi, beta: -psi, dr: 0 };
    }
    const c = t % 8;
    const phi = c < 0.9 ? DEMO_ROLL * (c / 0.9) : DEMO_ROLL * Math.exp(-0.75 * (c - 0.9));
    return { phi, psi: 0, beta: 0.5 * phi, dr: 0 };
  };

  // ---------- Render (outside / cockpit / split) ----------
  let labelW = 0;
  viewer.setRenderOverride(() => {
    const { w, h } = viewer.size();
    if (!w || !h) return;
    const setLabels = (lw: number) => {
      if (lw !== labelW) {
        labelW = lw;
        labelRenderer.setSize(lw, h);
      }
    };
    sky.position.copy(view === 'cockpit' ? new Vector3() : outsideCam.position);
    if (view === 'split') {
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);
      outsideCam.aspect = half / h;
      outsideCam.updateProjectionMatrix();
      renderer.setViewport(0, 0, half, h);
      renderer.setScissor(0, 0, half, h);
      renderer.render(scene, outsideCam);
      cockpitCam.aspect = (w - half) / h;
      cockpitCam.updateProjectionMatrix();
      renderer.setViewport(half, 0, w - half, h);
      renderer.setScissor(half, 0, w - half, h);
      renderer.render(scene, cockpitCam);
      renderer.setScissorTest(false);
      setLabels(half);
      labelRenderer.render(scene, outsideCam);
      return;
    }
    renderer.setViewport(0, 0, w, h);
    const cam = view === 'cockpit' ? cockpitCam : outsideCam;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    setLabels(w);
    labelRenderer.render(scene, cam);
  });

  // ---------- Frame loop ----------
  viewer.start((dtReal) => {
    time += dtReal;
    const dt = playing ? dtReal : 0;
    let pose: Pose;
    if (mode === 'live') {
      hooks.tick(dt);
      pose = hooks.pose();
    } else {
      demoT += dt;
      pose = demoPose(demoT);
    }
    attitude.rotation.set(0, -pose.psi, -pose.phi);
    ac.setRudder(pose.dr * DUTCH_ROLL.rudderVisualScale);

    // clouds move past at the true airspeed
    // the cloud deck streams AFT (toward +z) past the aircraft
    deckTex.offset.y += (airspeed * dt) / TILE;

    if (mode === 'live') {
      updateTrails(dt);
      // body-axis velocity direction: forward, turned right by β
      velArrow.set(P.nose, new Vector3(Math.sin(pose.beta), 0, -Math.cos(pose.beta)), PATH_LEN);
    }
    else {
      // wind arrows stream toward the aircraft; turned by the sideslip angle
      wind.rotation.y = mode === 'dihedral' ? -pose.beta : 0;
      const cyc = (demoT * 0.8) % 1;
      windArrows.forEach((a) =>
        mode === 'weathervane'
          ? a.set(new Vector3(a.group.userData.x as number, 1.5, -33 + cyc * 7), new Vector3(0, 0, 1), 7)
          : a.set(new Vector3(18 + (a.group.userData.x as number) * 0.6, 3 + (a.group.userData.x as number) * 0.5, -8 + cyc * 6), new Vector3(0, 0, 1), 6),
      );
      if (mode === 'weathervane') {
        const len = (Math.abs(pose.psi) / DEMO_YAW) * 5;
        finForce.set(P.finMid.clone().add(new Vector3(0.4 * Math.sign(pose.psi), 0, 0)), new Vector3(Math.sign(pose.psi) || 1, 0, 0), len);
        pFinForce.setAnchor(P.finMid.clone().add(new Vector3(Math.sign(pose.psi) * (len + 0.4), 0, 0)), v(6, 5, 0));
      } else {
        const k = pose.beta / (0.5 * DEMO_ROLL);
        liftR.set(P.rightWingMid, new Vector3(0, 1, 0), 3 + 2.5 * k);
        liftL.set(P.leftWingMid, new Vector3(0, 1, 0), Math.max(0.5, 3 - 2.0 * k));
        pLift.setAnchor(P.rightWingMid.clone().add(v(0, 3 + 2.5 * k, 0)), v(4, 3, 0));
      }
    }
    applyPulse();
  });

  refreshContext();
  return {
    setMode(m) {
      if (m === mode) return;
      mode = m;
      demoT = 0;
      viewer.setHome(...HOMES[m]);
      if (m === 'weathervane') pWind.setAnchor(v(-5, 1.5, -36), v(-6, 3, 0));
      if (m === 'dihedral') pWind.setAnchor(v(18, 3, -4), v(4, 4, 0));
      if (view !== 'cockpit') viewer.resetView();
      trailsFilled = false;
      refreshContext();
    },
    setView(vw) {
      view = vw;
      controls.enabled = vw !== 'cockpit';
    },
    setFocus(ids) {
      focus = ids;
      placards.setFocus(ids);
      refreshContext();
    },
    setLabelsOn(on) {
      placards.setLabelsOn(on);
    },
    setPlaying(p) {
      playing = p;
    },
    setAirspeed(vv) {
      airspeed = vv;
    },
    resetView() {
      viewer.resetView();
    },
    clearTrails() {
      trailsFilled = false;
    },
  };
}

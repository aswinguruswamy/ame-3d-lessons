/**
 * Lesson 2 entry: UI, physics and graph run at once; the 3D scene (Three.js) loads lazily.
 */
import '../../styles/base.css';
import '../../styles/lesson.css';
import '../../styles/dutch-roll.css';
import { DUTCH_ROLL as C } from '../../config/dutchRoll';
import { Tutorial, type TutorialStep } from '../../shared/tutorial';
import { bindSegmented, bindSlider, bindSwitch } from '../../shared/controls';
import {
  DEFAULT_PARAMS,
  DutchRollSim,
  I,
  dutchRollLikely,
  dutchRollMode,
  simulateRun,
  type DRParams,
  type Disturbance,
  type ModeInfo,
} from './physics';
import { DampingGraph } from './graph';
import { createOverheadPanel, createRudderIndicator } from './panels';
import type { DutchRollScene, SceneMode, ViewMode } from './scene';

type Step = TutorialStep & { enter: () => void };

// ---------- State ----------
let params: DRParams = { ...DEFAULT_PARAMS };
const sim = new DutchRollSim(params);
let scene: DutchRollScene | null = null;
let mode: SceneMode = 'live';
let view: ViewMode = 'outside';
let disturbance: Disturbance = 'gust';
let labelsOn = true;
let overlayOn = false;
let modeInfo: ModeInfo = dutchRollMode(params);
let env = 0;
let lastSampleT = -1;
let stepTimer = 0;

// ---------- Instruments ----------
const overhead = createOverheadPanel(document.getElementById('overhead')!, () => setYawDamper(!params.yawDamper));
const rudderInd = createRudderIndicator(document.getElementById('ecam')!);
const instruments = document.getElementById('instruments')!;
const graph = new DampingGraph(document.getElementById('graph') as HTMLCanvasElement);
const banner = document.getElementById('banner')!;

// ---------- Controls ----------
const S = C.sliders;
// Each slider: change the physics while dragging; when released, show what changed (ζ note)
// and start a fresh Dutch roll so the effect is visible at once.
const slider = (id: string, out: string, range: (typeof S)[keyof typeof S], digits: number, key: keyof DRParams) =>
  bindSlider(
    id,
    out,
    range,
    (v) => v.toFixed(digits),
    (v) => {
      if (!pending) pending = { before: modeInfo, params: { ...params } };
      setParams({ [key]: v } as Partial<DRParams>);
    },
    () => onSliderCommit(id, key),
  );
let pending: { before: ModeInfo; params: DRParams } | null = null;

/** Largest roll angle (deg) after a standard gust — shows how much the wings rock. */
function wingRock(p: DRParams) {
  const run = simulateRun(p, 20, 1 / 20, 'gust');
  return Math.max(...run.map((s) => Math.abs(s.phi))) * (180 / Math.PI);
}
const clIn = slider('in-cl', 'out-cl', S.clBeta, 2, 'clBeta');
const cnIn = slider('in-cn', 'out-cn', S.cnBeta, 2, 'cnBeta');
const kIn = slider('in-k', 'out-k', S.gain, 1, 'gain');
const vIn = slider('in-v', 'out-v', S.airspeed, 0, 'airspeed');
const ydSw = bindSwitch('sw-yd', (on) => setYawDamper(on));
const overlaySw = bindSwitch('sw-overlay', (on) => setOverlay(on));
const inputSeg = bindSegmented('[data-input]', 'input', (k) => {
  disturbance = k as Disturbance;
  inputSeg.set(k);
});
const viewSeg = bindSegmented('[data-view]', 'view', (vw) => setView(vw as ViewMode));
document.getElementById('btn-start')!.addEventListener('click', () => startDutchRoll());
const demoNote = document.getElementById('demo-note')!;
const legendGhost = document.getElementById('legend-ghost')!;
const noteTimers = new Map<string, number>();

/** Shows "ζ before → after" under the slider for a few seconds. */
function showDelta(inputId: string, key: keyof DRParams, before: ModeInfo, after: ModeInfo, beforeParams: DRParams) {
  const label = document.getElementById(inputId)!.closest('label')!;
  let note = label.nextElementSibling as HTMLElement | null;
  if (!note || !note.classList.contains('delta-note')) {
    note = document.createElement('div');
    note.className = 'delta-note';
    note.setAttribute('role', 'status');
    label.after(note);
  }
  let trend: string;
  let words: string;
  if (key === 'gain' && !params.yawDamper) {
    trend = 'same';
    words = 'Yaw damper is OFF: the gain has no effect until you switch it ON.';
  } else {
    if (!after.stable) [trend, words] = ['unstable', 'unstable: the oscillation grows!'];
    else if (after.zeta > before.zeta + 0.002) [trend, words] = ['better', 'damps faster'];
    else if (after.zeta < before.zeta - 0.002) [trend, words] = ['worse', 'damps slower'];
    else [trend, words] = ['same', 'about the same damping'];
    const rock0 = wingRock(beforeParams);
    const rock1 = wingRock(params);
    words =
      `ζ ${before.zeta.toFixed(3)} → ${after.zeta.toFixed(3)} (${words}) · ` +
      `period ${before.period.toFixed(1)} → ${after.period.toFixed(1)} s · ` +
      `wing rocking ${rock0.toFixed(1)}° → ${rock1.toFixed(1)}°`;
  }
  note.dataset.trend = trend;
  note.textContent = words;
  window.clearTimeout(noteTimers.get(inputId));
  noteTimers.set(
    inputId,
    window.setTimeout(() => note?.remove(), 7000),
  );
}

function onSliderCommit(inputId: string, key: keyof DRParams) {
  const before = pending?.before ?? modeInfo;
  const beforeParams = pending?.params ?? params;
  pending = null;
  showDelta(inputId, key, before, modeInfo, beforeParams);
  const noEffect = key === 'gain' && !params.yawDamper;
  if (mode === 'live' && !noEffect) startDutchRoll();
}

const stab = document.getElementById('stability')!;
const stabRatio = document.getElementById('stab-ratio')!;
const stabText = document.getElementById('stab-text')!;
const modeRows = document.getElementById('mode-rows')!;

function fmtMode(m: ModeInfo) {
  if (!m.stable) return `<td>${m.zeta.toFixed(3)}</td><td>${m.period.toFixed(1)} s</td><td class="warn">unstable (×2 in ${m.tHalf.toFixed(1)} s)</td>`;
  return `<td>${m.zeta.toFixed(3)}</td><td>${Number.isFinite(m.period) ? m.period.toFixed(1) + ' s' : '—'}</td><td>${m.tHalf.toFixed(1)} s</td>`;
}

function renderModeTable() {
  if (overlayOn) {
    const off = dutchRollMode({ ...params, yawDamper: false });
    const on = dutchRollMode({ ...params, yawDamper: true });
    modeRows.innerHTML = `<tr><th><i class="dot" style="background:#d13826"></i>YD OFF</th>${fmtMode(off)}</tr><tr><th><i class="dot" style="background:#1f8a4c"></i>YD ON</th>${fmtMode(on)}</tr>`;
  } else {
    modeRows.innerHTML = `<tr><th>${params.yawDamper ? 'YD ON' : 'YD OFF'}</th>${fmtMode(modeInfo)}</tr>`;
  }
}

function refreshDerived() {
  modeInfo = dutchRollMode(params);
  const ratio = params.clBeta / params.cnBeta;
  const likely = dutchRollLikely(params);
  stab.dataset.likely = String(likely);
  stabRatio.textContent = `|Clβ| / Cnβ = ${ratio.toFixed(2)}`;
  stabText.textContent = likely
    ? 'Lateral stability > directional stability → Dutch roll likely'
    : 'Directional stability is strong enough → Dutch roll less likely';
  renderModeTable();
  if (overlayOn) computeOverlay();
}

function syncUI() {
  clIn.set(params.clBeta);
  cnIn.set(params.cnBeta);
  kIn.set(params.gain);
  vIn.set(params.airspeed);
  ydSw.set(params.yawDamper);
  overlaySw.set(overlayOn);
  inputSeg.set(disturbance);
  viewSeg.set(view);
}

function setParams(patch: Partial<DRParams>) {
  params = { ...params, ...patch };
  sim.setParams(params);
  scene?.setAirspeed(params.airspeed);
  syncUI();
  refreshDerived();
}

function setYawDamper(on: boolean, animate = true) {
  if (on === params.yawDamper) return;
  setParams({ yawDamper: on });
  overhead.set(on, animate);
}

function setOverlay(on: boolean) {
  overlayOn = on;
  overlaySw.set(on);
  document.getElementById('legend-live')!.hidden = on;
  document.getElementById('legend-overlay')!.hidden = !on;
  if (on) computeOverlay();
  else graph.setOverlay(null);
  renderModeTable();
  graph.draw();
}

function computeOverlay() {
  const off = { ...params, yawDamper: false };
  const on = { ...params, yawDamper: true };
  graph.setOverlay([
    { label: 'OFF', color: '#d13826', points: simulateRun(off, graph.window, 1 / 20, disturbance), sigma: dutchRollMode(off).sigma },
    { label: 'ON', color: '#1f8a4c', points: simulateRun(on, graph.window, 1 / 20, disturbance), sigma: dutchRollMode(on).sigma },
  ]);
  graph.draw();
}

function setView(vw: ViewMode) {
  if (vw === 'split' && !splitAllowed.matches) vw = 'outside';
  view = vw;
  viewSeg.set(vw);
  scene?.setView(vw);
}
const splitAllowed = window.matchMedia('(min-width: 900px)');
splitAllowed.addEventListener('change', () => {
  if (view === 'split' && !splitAllowed.matches) setView('outside');
});

function setMode(m: SceneMode) {
  mode = m;
  demoNote.hidden = m === 'live';
  scene?.setMode(m);
}

function resetMotion() {
  sim.reset();
  graph.clear();
  graph.setGhost(null);
  legendGhost.hidden = true;
  env = 0;
  lastSampleT = -1;
  banner.hidden = true;
  scene?.clearTrails();
}

/**
 * Starts a fresh Dutch roll from straight flight. The yaw rate of the previous run stays
 * on the graph in grey, so the effect of a change is easy to compare.
 */
function startDutchRoll(kind: Disturbance = disturbance) {
  if (mode !== 'live') setMode('live');
  const previous = Number.isFinite(sim.tDisturb) ? graph.samplesSince(sim.tDisturb) : null;
  resetMotion();
  if (previous && previous.length > 30) {
    graph.setGhost(previous, 0);
    legendGhost.hidden = false;
  }
  sim.disturb(kind);
}

/** Starts a fresh Dutch roll if the current one has (almost) died out. */
function ensureOscillation() {
  if (sim.outOfRange || graph.recentMax(6) < 0.6 / 57.3) {
    resetMotion();
    sim.disturb('gust');
  }
}

// ---------- Labels / view buttons ----------
const labelsBtn = document.getElementById('btn-labels')!;
function setLabels(on: boolean) {
  labelsOn = on;
  labelsBtn.textContent = on ? 'Labels ON' : 'Labels OFF';
  labelsBtn.setAttribute('aria-pressed', String(on));
  scene?.setLabelsOn(on);
}
labelsBtn.addEventListener('click', () => setLabels(!labelsOn));
document.getElementById('btn-view')!.addEventListener('click', () => {
  if (view === 'cockpit') setView('outside');
  scene?.resetView();
});

// ---------- Tutorial ----------
const STEPS: Step[] = [
  {
    title: 'Stable, straight flight',
    caption:
      'An A320-class airliner flies straight and level at cruise. Its swept wings, fin and rudder decide how it moves sideways. Nothing disturbs the aircraft yet.',
    focus: ['fin', 'wing', 'engine'],
    enter: () => {
      setMode('live');
      setYawDamper(false, false);
      resetMotion();
      setView('outside');
      setOverlay(false);
    },
  },
  {
    title: 'Directional stability (weathervane effect)',
    caption:
      'When the nose turns away from the relative wind, the air hits the side of the fin. The fin makes a side force that turns the nose back into the wind, like a weathervane. A larger Cnβ gives a stronger effect.',
    focus: ['fin', 'wind', 'finForce'],
    enter: () => {
      setMode('weathervane');
      setView('outside');
      setOverlay(false);
    },
  },
  {
    title: 'Lateral stability (dihedral effect)',
    caption:
      'When the wings tilt, the aircraft slips sideways toward the low wing. Dihedral (the upward angle of the wings) and sweep give the low wing more lift, so the wings return to level. Swept wings make this effect strong.',
    focus: ['dihedral', 'wind', 'wingLift'],
    enter: () => {
      setMode('dihedral');
      setView('outside');
      setOverlay(false);
    },
  },
  {
    title: 'A gust starts the Dutch roll',
    caption:
      'A side gust pushes the nose sideways. The strong dihedral effect turns this yaw into roll, and the two motions keep feeding each other. Yaw and roll are out of phase: the wings rock while the nose swings left and right.',
    focus: ['yaw', 'roll', 'flightPath'],
    enter: () => {
      setMode('live');
      setYawDamper(false, false);
      resetMotion();
      sim.disturb('gust');
      setView('outside');
      setOverlay(false);
    },
  },
  {
    title: 'The same motion from the cockpit',
    caption:
      'From the pilot seat, the horizon tilts while the nose swings across it. The yellow symbol is fixed to the aircraft, so it shows where the nose points. The motion keeps going because it is lightly damped.',
    focus: [],
    enter: () => {
      setMode('live');
      setYawDamper(false, false);
      ensureOscillation();
      setView('cockpit');
      setOverlay(false);
    },
  },
  {
    title: 'The pilot selects the yaw damper',
    caption:
      'The yaw damper senses the yaw rate and moves the rudder against it. Watch the FAC 1 pushbutton, the rudder indicator and the 3D rudder move together. The rudder always pushes against the swing of the nose.',
    focus: ['rudder', 'panel'],
    enter: () => {
      setMode('live');
      setYawDamper(false, false);
      ensureOscillation();
      setView('outside');
      setOverlay(false);
      stepTimer = window.setTimeout(() => setYawDamper(true, true), 2200);
    },
  },
  {
    title: 'The oscillation dies out',
    caption:
      'With the yaw damper ON, the Dutch roll dies out in a few cycles. The graph compares the yaw rate with the yaw damper OFF and ON. Compare the damping ratio ζ and the time to half amplitude.',
    focus: ['rudder'],
    enter: () => {
      setMode('live');
      setYawDamper(true, false);
      setView('outside');
      setOverlay(true);
    },
  },
];

const tutorial = new Tutorial(STEPS);

function applyStep(i: number) {
  window.clearTimeout(stepTimer);
  STEPS[i].enter();
  scene?.setFocus(STEPS[i].focus);
  instruments.classList.toggle('is-focus', STEPS[i].focus.includes('panel'));
}

// ---------- Physics tick (called by the 3D frame loop) ----------
const SAMPLE_DT = 1 / 30;
let uiTimer = 0;

function onStep() {
  // decay envelope: falls at the Dutch roll rate σ, but never below |r|
  const r = Math.abs(sim.x[I.r]);
  env = Math.max(env * Math.exp(modeInfo.sigma * C.dt), r);
  if (sim.t - lastSampleT >= SAMPLE_DT - 1e-9) {
    lastSampleT = sim.t;
    graph.push({ t: sim.t, r: sim.x[I.r], phi: sim.x[I.phi], dr: sim.x[I.dr], env });
  }
}

function tick(dt: number) {
  if (mode === 'live') sim.advance(dt, onStep);
  rudderInd.set(mode === 'live' ? sim.x[I.dr] : 0, C.rudderLimit);
  banner.hidden = !sim.outOfRange;
  uiTimer -= dt || 1 / 60;
  if (uiTimer <= 0 && !overlayOn) {
    uiTimer = 1 / 30;
    graph.draw();
  }
}

// Dev-only hook for automated checks: fast-forward the physics (not in production builds).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__dr = {
    sim,
    advance: (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) tick(1 / 60);
      graph.draw();
    },
  };
}

// ---------- Start-up ----------
overhead.set(false, false);
syncUI();
refreshDerived();
graph.draw();

const stage = document.getElementById('stage')!;
const loading = document.getElementById('loading')!;
import('./scene')
  .then(({ createDutchRollScene }) => {
    scene = createDutchRollScene(stage, {
      tick,
      pose: () => ({ phi: sim.x[I.phi], psi: sim.x[I.psi], beta: sim.x[I.beta], dr: sim.x[I.dr] }),
    });
    scene.setAirspeed(params.airspeed);
    scene.setLabelsOn(labelsOn);
    scene.setMode(mode);
    scene.setView(view);
    loading.remove();
    tutorial.connect({
      onStep: (i) => applyStep(i),
      onPlayPause: (p) => scene?.setPlaying(p),
      onReset: () => {
        window.clearTimeout(stepTimer);
        params = { ...DEFAULT_PARAMS };
        sim.setParams(params);
        overhead.set(false, false);
        disturbance = 'gust';
        setLabels(true);
        syncUI();
        refreshDerived();
        resetMotion();
        setView('outside');
        scene?.resetView();
      },
    });
  })
  .catch((err) => {
    console.error(err);
    loading.textContent = 'The 3D scene could not load. Please check that WebGL is enabled in your browser.';
  });

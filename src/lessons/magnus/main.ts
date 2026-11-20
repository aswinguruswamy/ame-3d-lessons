/**
 * Lesson 1 entry: builds the UI at once, then loads the 3D scene (and Three.js) lazily.
 */
import '../../styles/base.css';
import '../../styles/lesson.css';
import { MAGNUS } from '../../config/magnus';
import { Tutorial, type TutorialStep } from '../../shared/tutorial';
import { bindSegmented, bindSlider, bindSwitch } from '../../shared/controls';
import type { MagnusParams, MagnusScene } from './scene';
import { magnusState, type MagnusState } from './physics';

interface StepSetup {
  spinOn: boolean;
  pressureMap: boolean;
  pressureArrows: boolean;
}

const STEPS: (TutorialStep & { setup: StepSetup })[] = [
  {
    title: 'Air flows past a still cylinder',
    caption:
      'Air flows from left to right past a cylinder that does not turn. The flow is the same above and below the cylinder. The pressures balance, so the lift is zero.',
    focus: ['freestream', 'cylinder'],
    setup: { spinOn: false, pressureMap: false, pressureArrows: false },
  },
  {
    title: 'The cylinder starts to turn',
    caption:
      'The cylinder now turns about its axis. Friction makes the surface pull a thin layer of air around with it. This thin layer is the <b>boundary layer</b>.',
    focus: ['cylinder', 'boundary'],
    setup: { spinOn: true, pressureMap: false, pressureArrows: false },
  },
  {
    title: 'One side fast, one side slow',
    caption:
      'On one side the surface moves with the airflow, so the air there moves faster. On the other side the surface moves against the airflow, so the air moves slower.',
    focus: ['fastSide', 'slowSide'],
    setup: { spinOn: true, pressureMap: false, pressureArrows: false },
  },
  {
    title: 'Faster air has lower pressure',
    caption:
      'Bernoulli’s principle: where air moves faster, its pressure is lower. The fast side now shows low pressure (blue) and the slow side shows high pressure (red). This is the <b>pressure difference, ΔP</b>.',
    focus: ['fastSide', 'slowSide', 'deltaP'],
    setup: { spinOn: true, pressureMap: true, pressureArrows: true },
  },
  {
    title: 'The pressure difference makes lift',
    caption:
      'The high pressure pushes the cylinder toward the low-pressure side. This net force is the <b>Magnus lift</b>. Lift per metre of span is L′ = ρ · V · Γ, and the circulation Γ grows with the spin rate.',
    focus: ['lift', 'deltaP'],
    setup: { spinOn: true, pressureMap: true, pressureArrows: true },
  },
  {
    title: 'The wake moves to one side',
    caption:
      'The cylinder turns the air behind it to one side: the <b>deflected wake (downwash)</b>. By Newton’s third law, the air pushes the cylinder the other way. Try the other spin direction: the wake and the lift both reverse.',
    focus: ['wake', 'lift'],
    setup: { spinOn: true, pressureMap: true, pressureArrows: false },
  },
];

const DEFAULTS: MagnusParams = {
  rpm: MAGNUS.rpm.default,
  airspeed: MAGNUS.airspeed.default,
  spinOn: false,
  direction: 'cw',
  pressureMap: false,
  pressureArrows: false,
};

let params: MagnusParams = { ...DEFAULTS };
let scene: MagnusScene | null = null;
let labelsOn = true;

// ---------- Controls ----------
const rpm = bindSlider('in-rpm', 'out-rpm', MAGNUS.rpm, (v) => v.toFixed(0), (v) => set({ rpm: v }));
const speed = bindSlider('in-speed', 'out-speed', MAGNUS.airspeed, (v) => v.toFixed(1), (v) => set({ airspeed: v }));
const spin = bindSwitch('sw-spin', (on) => set({ spinOn: on }));
const map = bindSwitch('sw-map', (on) => set({ pressureMap: on }));
const arrows = bindSwitch('sw-arrows', (on) => set({ pressureArrows: on }));
const dir = bindSegmented('[data-dir]', 'dir', (d) => set({ direction: d as MagnusParams['direction'] }));
const legend = document.getElementById('legend')!;

function set(patch: Partial<MagnusParams>) {
  params = { ...params, ...patch };
  rpm.set(params.rpm);
  speed.set(params.airspeed);
  spin.set(params.spinOn);
  map.set(params.pressureMap);
  arrows.set(params.pressureArrows);
  dir.set(params.direction);
  legend.hidden = !params.pressureMap;
  scene?.setParams(params);
  if (!scene) renderReadout(magnusState(params));
}

const labelsBtn = document.getElementById('btn-labels')!;
function setLabels(on: boolean) {
  labelsOn = on;
  labelsBtn.textContent = on ? 'Labels ON' : 'Labels OFF';
  labelsBtn.setAttribute('aria-pressed', String(on));
  scene?.setLabelsOn(on);
}
labelsBtn.addEventListener('click', () => setLabels(!labelsOn));
document.getElementById('btn-view')!.addEventListener('click', () => scene?.resetView());

// ---------- Live readout ----------
const ro = {
  lift: document.getElementById('ro-lift')!,
  dir: document.getElementById('ro-dir')!,
  formula: document.getElementById('ro-formula')!,
  alpha: document.getElementById('ro-alpha')!,
  gamma: document.getElementById('ro-gamma')!,
  dp: document.getElementById('ro-dp')!,
  q: document.getElementById('ro-q')!,
  note: document.getElementById('ro-note')!,
};
function renderReadout(s: MagnusState) {
  const V = params.airspeed;
  const L = s.liftPerSpan;
  ro.lift.textContent = Math.abs(L).toFixed(1);
  ro.dir.textContent = Math.abs(L) < 0.05 ? 'no lift' : L > 0 ? '↑ up' : '↓ down';
  ro.dir.dataset.dir = Math.abs(L) < 0.05 ? 'none' : L > 0 ? 'up' : 'down';
  ro.formula.textContent = `= ${MAGNUS.rho} × ${V.toFixed(1)} × ${Math.abs(s.gamma).toFixed(2)}`;
  ro.alpha.textContent = Math.abs(s.spinRatio).toFixed(2);
  ro.gamma.textContent = `${Math.abs(s.gamma).toFixed(2)} m²/s`;
  ro.dp.textContent = `${s.deltaP.toFixed(0)} Pa`;
  ro.q.textContent = `${s.q.toFixed(0)} Pa`;
  ro.note.hidden = !s.limited;
}

// ---------- Tutorial ----------
const tutorial = new Tutorial(STEPS);
set({}); // initial UI state

function applyStep(i: number) {
  const st = STEPS[i];
  set(st.setup);
  scene?.setFocus(st.focus);
}

// ---------- Lazy-load the 3D scene ----------
const stage = document.getElementById('stage')!;
const loading = document.getElementById('loading')!;
import('./scene')
  .then(({ createMagnusScene }) => {
    scene = createMagnusScene(stage);
    scene.onState(renderReadout);
    scene.setLabelsOn(labelsOn);
    scene.setParams(params);
    loading.remove();
    tutorial.connect({
      onStep: (i) => applyStep(i),
      onPlayPause: (p) => scene?.setPlaying(p),
      onReset: () => {
        params = { ...DEFAULTS };
        set({});
        setLabels(true);
        scene?.resetAnimation();
        scene?.resetView();
      },
    });
  })
  .catch((err) => {
    console.error(err);
    loading.textContent = 'The 3D scene could not load. Please check that WebGL is enabled in your browser.';
  });

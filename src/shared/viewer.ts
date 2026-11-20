/**
 * Viewer: WebGL renderer + camera + orbit controls + HTML label layer.
 * Keeps the frame loop simple: no post-processing, pixel ratio capped.
 */
import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export interface ViewerOptions {
  container: HTMLElement;
  background: number;
  cameraPosition: Vector3;
  target: Vector3;
  fov?: number;
  /**
   * The start view is framed for this width/height ratio. On narrower screens the
   * camera moves back so the same width of the scene still fits.
   */
  fitAspect?: number;
}

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly clock = new Clock();
  private readonly home: { position: Vector3; target: Vector3 };
  private update: ((dt: number) => void) | null = null;

  constructor(private readonly opts: ViewerOptions) {
    const { container } = opts;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'viewer-canvas';
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'viewer-labels';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new Color(opts.background);
    this.scene.add(new HemisphereLight(0xffffff, 0xb8b4a8, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 9, 8);
    this.scene.add(sun);

    this.camera = new PerspectiveCamera(opts.fov ?? 40, 1, 0.1, 400);
    this.home = { position: opts.cameraPosition.clone(), target: opts.target.clone() };

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.controls.screenSpacePanning = true;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.resetView();
  }


  resize() {
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
  }

  /** Puts the camera back to the start position. */
  resetView() {
    const { position, target } = this.home;
    const dir = position.clone().sub(target);
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    const aspect = w && h ? w / h : 1.5;
    dir.multiplyScalar(Math.max(1, (this.opts.fitAspect ?? 1.3) / aspect));
    this.camera.position.copy(target).add(dir);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** Starts the frame loop. `update` gets real seconds since the last frame. */
  start(update: (dt: number) => void) {
    this.update = update;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Nudges HTML labels back inside the stage so none are cut off at the edges. */
  private keepLabelsOnScreen() {
    const host = this.labelRenderer.domElement;
    const box = host.getBoundingClientRect();
    const pad = 6;
    for (const el of host.children as HTMLCollectionOf<HTMLElement>) {
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (r.left < box.left + pad) dx = box.left + pad - r.left;
      else if (r.right > box.right - pad) dx = box.right - pad - r.right;
      if (r.top < box.top + pad) dy = box.top + pad - r.top;
      else if (r.bottom > box.bottom - pad) dy = box.bottom - pad - r.bottom;
      if (dx || dy) el.style.transform += ` translate(${dx}px, ${dy}px)`;
    }
  }

  /** Average JS time per frame in ms (update + render submit). Read in dev tools: window.__frameMs */
  frameMs = 0;

  private frame() {
    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.update?.(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.keepLabelsOnScreen();
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
    (window as unknown as { __frameMs: number }).__frameMs = this.frameMs;
  }
}

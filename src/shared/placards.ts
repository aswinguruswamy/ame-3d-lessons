/**
 * Placards: callout labels with a leader line from a point on a part to an HTML label.
 * The label is HTML (sharp text, easy to style); the leader line and dot are 3D.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const INK = 0x1d2733;
const ACCENT = 0xd9822b;
const dotGeometry = new SphereGeometry(0.07, 12, 8);
/** On small screens only the labels of the current step are shown, to avoid clutter. */
const compact = window.matchMedia('(max-width: 860px)');

export class Placard {
  readonly group = new Group();
  readonly label: CSS2DObject;
  private readonly el: HTMLDivElement;
  private readonly line: Line;
  private readonly lineMat = new LineBasicMaterial({ color: INK, depthTest: false, transparent: true });
  private readonly dotMat = new MeshBasicMaterial({ color: INK, depthTest: false, transparent: true });
  private readonly dot: Mesh;
  private contextVisible = true;

  constructor(
    readonly id: string,
    text: string,
    anchor: Vector3,
    offset: Vector3,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'placard';
    this.el.textContent = text;
    this.label = new CSS2DObject(this.el);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.line = new Line(geo, this.lineMat);
    this.line.renderOrder = 10;
    this.line.frustumCulled = false;
    this.dot = new Mesh(dotGeometry, this.dotMat);
    this.dot.renderOrder = 10;

    this.group.add(this.line, this.dot, this.label);
    this.setAnchor(anchor, offset);
  }

  /** Moves the anchor point; the label sits at anchor + offset. */
  setAnchor(anchor: Vector3, offset: Vector3) {
    const tip = anchor.clone().add(offset);
    const pos = this.line.geometry.getAttribute('position') as Float32BufferAttribute;
    pos.setXYZ(0, anchor.x, anchor.y, anchor.z);
    pos.setXYZ(1, tip.x, tip.y, tip.z);
    pos.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.dot.position.copy(anchor);
    this.label.position.copy(tip);
    // Attach the label by the edge that faces the anchor.
    // (uses x, or z when the offset is mainly along z — e.g. side views)
    const h = Math.abs(offset.x) >= Math.abs(offset.z) ? offset.x : offset.z;
    this.label.center.set(h >= 0 ? 0 : 1, offset.y > 0.3 ? 1 : offset.y < -0.3 ? 0 : 0.5);
  }

  setText(text: string) {
    if (this.el.textContent !== text) this.el.textContent = text;
  }

  /** Hide or show the placard because of the lesson state (e.g. spin OFF). */
  setContextVisible(v: boolean) {
    this.contextVisible = v;
  }

  apply(labelsOn: boolean, state: 'focus' | 'dim' | 'normal') {
    this.group.visible = labelsOn && this.contextVisible && !(state === 'dim' && compact.matches);
    this.el.classList.toggle('is-focus', state === 'focus');
    this.el.classList.toggle('is-dim', state === 'dim');
    const color = state === 'focus' ? ACCENT : INK;
    this.lineMat.color.setHex(color);
    this.dotMat.color.setHex(color);
    const opacity = state === 'dim' ? 0.35 : 1;
    this.lineMat.opacity = opacity;
    this.dotMat.opacity = opacity;
  }
}

export class PlacardSet {
  readonly group = new Group();
  private readonly items = new Map<string, Placard>();
  private labelsOn = true;
  private focus: string[] = [];

  constructor() {
    compact.addEventListener('change', () => this.refresh());
  }

  add(p: Placard) {
    this.items.set(p.id, p);
    this.group.add(p.group);
    return p;
  }

  get(id: string) {
    return this.items.get(id)!;
  }

  setLabelsOn(on: boolean) {
    this.labelsOn = on;
    this.refresh();
  }

  setFocus(ids: string[]) {
    this.focus = ids;
    this.refresh();
  }

  refresh() {
    for (const p of this.items.values()) {
      const state = this.focus.length === 0 ? 'normal' : this.focus.includes(p.id) ? 'focus' : 'dim';
      p.apply(this.labelsOn, state);
    }
  }
}

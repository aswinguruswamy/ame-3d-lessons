/**
 * Solid 3D arrows. `Arrow` is one arrow; `ArrowField` draws many arrows with
 * two instanced meshes (one draw call for all shafts, one for all heads).
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';

const UP = new Vector3(0, 1, 0);
const shaftGeo = new CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
const headGeo = new ConeGeometry(1, 1, 14).translate(0, 0.5, 0);

export class Arrow {
  readonly group = new Group();
  readonly shaft: Mesh;
  readonly head: Mesh;
  readonly material: MeshStandardMaterial;

  constructor(
    color: number,
    private readonly radius = 0.07,
    private readonly headLength = 0.4,
  ) {
    this.material = new MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0.15 });
    this.shaft = new Mesh(shaftGeo, this.material);
    this.head = new Mesh(headGeo, this.material);
    this.group.add(this.shaft, this.head);
  }

  /** Points the arrow from `origin` along `dir` with total `length`. Hides it when length ≈ 0. */
  set(origin: Vector3, dir: Vector3, length: number) {
    this.group.visible = length > 0.02;
    if (!this.group.visible) return;
    const head = Math.min(this.headLength, length * 0.5);
    const q = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    this.group.position.copy(origin);
    this.group.quaternion.copy(q);
    this.shaft.scale.set(this.radius, length - head, this.radius);
    this.head.position.set(0, length - head, 0);
    this.head.scale.set(this.radius * 2.6, head, this.radius * 2.6);
  }
}

const m = new Matrix4();
const q = new Quaternion();
const s = new Vector3();
const p = new Vector3();
const d = new Vector3();

export class ArrowField {
  readonly group = new Group();
  private readonly shafts: InstancedMesh;
  private readonly heads: InstancedMesh;

  constructor(
    readonly count: number,
    material: Material,
    private readonly radius = 0.035,
  ) {
    this.shafts = new InstancedMesh(shaftGeo, material, count);
    this.heads = new InstancedMesh(headGeo, material, count);
    this.shafts.frustumCulled = false;
    this.heads.frustumCulled = false;
    const white = new Color(1, 1, 1);
    for (let i = 0; i < count; i++) {
      this.shafts.setColorAt(i, white);
      this.heads.setColorAt(i, white);
    }
    this.group.add(this.shafts, this.heads);
  }

  /** Sets arrow i: from `from` toward `to`. */
  set(i: number, from: Vector3, to: Vector3, color: Color) {
    d.subVectors(to, from);
    const length = d.length();
    if (length < 1e-4) {
      m.makeScale(0, 0, 0);
      this.shafts.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
      return;
    }
    d.divideScalar(length);
    q.setFromUnitVectors(UP, d);
    const head = Math.min(0.22, length * 0.5);
    s.set(this.radius, length - head, this.radius);
    m.compose(from, q, s);
    this.shafts.setMatrixAt(i, m);
    p.copy(from).addScaledVector(d, length - head);
    s.set(this.radius * 2.8, head, this.radius * 2.8);
    m.compose(p, q, s);
    this.heads.setMatrixAt(i, m);
    this.shafts.setColorAt(i, color);
    this.heads.setColorAt(i, color);
  }

  commit() {
    this.shafts.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    if (this.shafts.instanceColor) this.shafts.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }
}

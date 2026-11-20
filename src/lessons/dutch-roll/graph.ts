/**
 * Live damping graph (Canvas 2D): yaw rate, roll angle and rudder against time,
 * with the decay envelope of the yaw rate. "Overlay" mode compares a yaw damper OFF
 * run with an ON run on the same axes.
 */
const RAD = 180 / Math.PI;

export interface Sample {
  t: number;
  r: number;
  phi: number;
  dr: number;
  /** Envelope of |r| (rad/s). */
  env: number;
}

export interface OverlayRun {
  label: string;
  color: string;
  points: { t: number; r: number }[];
  /** Real part of the Dutch roll root, 1/s (for the envelope). */
  sigma: number;
}

const COLORS = { r: '#1c5fc7', phi: '#d9822b', dr: '#1f8a4c', env: '#7b8490', grid: '#e4e0d6', axis: '#9aa1aa', text: '#4a5563' };

function niceMax(v: number) {
  const steps = [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 10) * 10;
}

export class DampingGraph {
  private readonly ctx: CanvasRenderingContext2D;
  private samples: Sample[] = [];
  private overlay: OverlayRun[] | null = null;
  readonly window = 30;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  push(s: Sample) {
    this.samples.push(s);
    const cut = s.t - this.window - 1;
    if (this.samples.length > 2000 && this.samples[0].t < cut) {
      let i = 0;
      while (this.samples[i].t < cut) i++;
      this.samples.splice(0, i);
    }
  }

  clear() {
    this.samples = [];
  }

  /** Largest |r| (rad/s) in the last `seconds`. */
  recentMax(seconds: number) {
    const last = this.samples[this.samples.length - 1];
    if (!last) return 0;
    let m = 0;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].t > last.t - seconds; i--) m = Math.max(m, Math.abs(this.samples[i].r));
    return m;
  }

  setOverlay(runs: OverlayRun[] | null) {
    this.overlay = runs;
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const L = 34;
    const Rm = 8;
    const T = 8;
    const B = 20;
    const pw = cw - L - Rm;
    const ph = ch - T - B;

    // time range and data
    let t0: number;
    let t1: number;
    let ymax = 0.5;
    if (this.overlay) {
      t0 = 0;
      t1 = this.window;
      for (const run of this.overlay) for (const p of run.points) ymax = Math.max(ymax, Math.abs(p.r) * RAD);
    } else {
      const last = this.samples[this.samples.length - 1];
      t1 = Math.max(this.window, last ? last.t : 0);
      t0 = t1 - this.window;
      for (const s of this.samples) {
        if (s.t < t0) continue;
        ymax = Math.max(ymax, Math.abs(s.r) * RAD, Math.abs(s.phi) * RAD, Math.abs(s.dr) * RAD, s.env * RAD);
      }
    }
    ymax = niceMax(ymax * 1.05);
    const X = (t: number) => L + ((t - t0) / (t1 - t0)) * pw;
    const Y = (v: number) => T + ph / 2 - (v / ymax) * (ph / 2);

    // grid + axes
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.text;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const f of [-1, -0.5, 0, 0.5, 1]) {
      const y = Math.round(Y(f * ymax)) + 0.5;
      ctx.strokeStyle = f === 0 ? COLORS.axis : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L + pw, y);
      ctx.stroke();
      ctx.fillText(String(+(f * ymax).toFixed(1)), L - 4, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const firstTick = Math.ceil(t0 / 5) * 5;
    for (let t = firstTick; t <= t1 + 1e-6; t += 5) {
      const x = Math.round(X(t)) + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, T);
      ctx.lineTo(x, T + ph);
      ctx.stroke();
      ctx.fillText(`${Math.round(t - (this.overlay ? 0 : 0))} s`, x, T + ph + 4);
    }

    const line = (pts: { x: number; y: number }[], color: string, width = 1.75, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(L, T - 2, pw, ph + 4);
    ctx.clip();
    if (this.overlay) {
      for (const run of this.overlay) {
        line(run.points.map((p) => ({ x: X(p.t), y: Y(p.r * RAD) })), run.color, 2);
        // envelope from the first peak: A(t) = A_peak · e^{σ (t − t_peak)}
        let pk = run.points[0];
        for (const p of run.points) if (p.t < 4 && Math.abs(p.r) > Math.abs(pk.r)) pk = p;
        const A = Math.abs(pk.r);
        const env: { x: number; y: number }[] = [];
        const envN: { x: number; y: number }[] = [];
        for (let t = pk.t; t <= t1; t += 0.25) {
          const a = A * Math.exp(run.sigma * (t - pk.t)) * RAD;
          env.push({ x: X(t), y: Y(a) });
          envN.push({ x: X(t), y: Y(-a) });
        }
        line(env, run.color, 1.2, [5, 4]);
        line(envN, run.color, 1.2, [5, 4]);
      }
    } else {
      const vis = this.samples.filter((s) => s.t >= t0 - 0.1);
      line(vis.map((s) => ({ x: X(s.t), y: Y(s.env * RAD) })), COLORS.env, 1.2, [5, 4]);
      line(vis.map((s) => ({ x: X(s.t), y: Y(-s.env * RAD) })), COLORS.env, 1.2, [5, 4]);
      line(vis.map((s) => ({ x: X(s.t), y: Y(s.dr * RAD) })), COLORS.dr, 1.6);
      line(vis.map((s) => ({ x: X(s.t), y: Y(s.phi * RAD) })), COLORS.phi, 1.8);
      line(vis.map((s) => ({ x: X(s.t), y: Y(s.r * RAD) })), COLORS.r, 2);
    }
    ctx.restore();
  }
}

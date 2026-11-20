/**
 * Diverging pressure colour map: blue = low pressure, grey = free-stream pressure,
 * red = high pressure. Used by the 3D scene and by the CSS legend.
 */
export const PRESSURE_COLORS = {
  low: [0.11, 0.37, 0.78], // #1c5fc7
  mid: [0.74, 0.75, 0.77], // #bdbfc4
  high: [0.82, 0.22, 0.15], // #d13826
} as const;

/** Writes linear-ish RGB (0..1) for a pressure coefficient into out[offset..offset+2]. */
export function pressureColor(
  cp: number,
  cpLow: number,
  cpHigh: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  let t: number;
  let from: readonly number[];
  let to: readonly number[];
  if (cp >= 0) {
    t = Math.min(cp / cpHigh, 1);
    from = PRESSURE_COLORS.mid;
    to = PRESSURE_COLORS.high;
  } else {
    t = Math.min(cp / cpLow, 1);
    from = PRESSURE_COLORS.mid;
    to = PRESSURE_COLORS.low;
  }
  // ease so small differences are still visible
  t = Math.sqrt(t);
  out[offset] = from[0] + (to[0] - from[0]) * t;
  out[offset + 1] = from[1] + (to[1] - from[1]) * t;
  out[offset + 2] = from[2] + (to[2] - from[2]) * t;
}

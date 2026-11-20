/**
 * Lesson 2 — Dutch roll and the yaw damper: all physics values in one place.
 *
 * The model is an A320-CLASS airliner, not a certified A320 data set. Airbus does not
 * publish its stability derivatives. Geometry is from Airbus public documents; the
 * aerodynamic derivatives are typical values for a swept-wing twin-jet transport,
 * chosen inside the ranges given by the textbooks below. They are marked
 * "APPROXIMATE, for teaching".
 *
 * Sources
 * [D1] Airbus, "A320 Aircraft Characteristics — Airport and Maintenance Planning" (AC).
 *      Span 34.10 m (35.80 m with sharklets), length 37.57 m, height 11.76 m.
 * [D2] Airbus A320 family technical data (airbus.com): wing area 122.6 m², wing sweep 25°.
 * [D3] ICAO Doc 7488/3, Manual of the ICAO Standard Atmosphere: ρ at 35 000 ft = 0.3796 kg/m³.
 * [D4] R. C. Nelson, Flight Stability and Automatic Control, 2nd ed., McGraw-Hill (1998),
 *      Ch. 5 (lateral equations, Dutch roll) and Ch. 10 (yaw damper with washout).
 * [D5] J. Roskam, Airplane Flight Dynamics and Automatic Flight Controls, Part I,
 *      DARcorporation (2001): typical derivatives of jet transports; radii of gyration
 *      for estimating inertias.
 * [D6] R. K. Heffley, W. F. Jewell, "Aircraft Handling Qualities Data", NASA CR-2144 (1972):
 *      derivative data for jet transports (CV-880, DC-8, B-747) used to check magnitudes.
 * [D7] Airbus A320 FCOM, DSC-27 Flight Controls (FAC pushbuttons, yaw damper, rudder
 *      travel limiter). Proprietary manual: values below are typical, see notes.
 */

const DEG = Math.PI / 180;

export const DUTCH_ROLL = {
  /** Gravity, m/s². */
  g: 9.80665,

  /** Air density at FL350 (ISA), kg/m³ [D3]. Exact for the ISA. */
  rho: 0.3796,

  geometry: {
    /** Wing span without sharklets, m [D1]. */
    span: 34.1,
    /** Reference wing area, m² [D2]. */
    area: 122.6,
    /** Overall length, m [D1]. */
    length: 37.57,
    /** Quarter-chord sweep, deg [D2]. */
    sweepDeg: 25,
    /** Wing dihedral, deg. APPROXIMATE (commonly quoted value ≈ 5°). */
    dihedralDeg: 5.1,
  },

  /** Typical cruise mass, kg. APPROXIMATE (MTOW is 78 t; cruise mass ≈ 60–70 t). */
  mass: 64000,

  /**
   * Moments of inertia, kg·m². APPROXIMATE, for teaching.
   * Estimated with Roskam's radii of gyration for twin-jet transports [D5]:
   * Ixx = m (b·Rx/2)², Izz = m (((b + L)/2)·Rz/2)² with Rx ≈ 0.25, Rz ≈ 0.45.
   * Ixz is neglected (stability axes).
   */
  inertia: { Ixx: 1.2e6, Izz: 4.0e6 },

  /**
   * Non-dimensional derivatives, per radian (stability axes).
   * APPROXIMATE, for teaching: typical swept-wing twin-jet values in cruise [D4][D5][D6].
   * Rudder sign convention in this lesson: positive δr = rudder trailing edge to the RIGHT,
   * which yaws the nose RIGHT (so Cnδr > 0).
   */
  derivatives: {
    Cy_beta: -0.7,
    Cl_beta: -0.12, // dihedral effect (slider)
    Cn_beta: 0.11, // weathervane effect (slider)
    Cl_p: -0.45,
    Cl_r: 0.15,
    Cn_p: -0.03,
    Cn_r: -0.12,
    Cy_dr: -0.2,
    Cl_dr: -0.015,
    Cn_dr: 0.1,
  },

  /** Slider ranges. Clβ is shown as its size |Clβ| because it is negative when stable. */
  sliders: {
    clBeta: { min: 0.02, max: 0.3, step: 0.01, default: 0.12 },
    cnBeta: { min: 0.03, max: 0.25, step: 0.01, default: 0.11 },
    gain: { min: 0, max: 3, step: 0.1, default: 1.2 },
    /** True airspeed, m/s. 230 m/s ≈ Mach 0.78 at FL350. */
    airspeed: { min: 150, max: 250, step: 5, default: 230 },
  },

  /**
   * "Dutch roll likely" label shows when |Clβ| / Cnβ is above this value.
   * APPROXIMATE, for teaching: a simple rule of thumb, not a certification criterion.
   */
  dutchRollRatioLimit: 1.0,

  yawDamper: {
    /** Washout time constant τ, s: removes steady yaw rate so turns are not opposed [D4]. APPROXIMATE. */
    washoutTau: 2.0,
    /** Rudder actuator time constant, s. APPROXIMATE. */
    actuatorTau: 0.1,
    /** Max rudder rate, rad/s. APPROXIMATE (order of 25–40°/s for transport rudders). */
    rateLimit: 25 * DEG,
    /** Yaw-damper authority, rad. APPROXIMATE (the FAC limits yaw-damper authority) [D7]. */
    authority: 10 * DEG,
  },

  /** Rudder travel limit at cruise speed, rad. APPROXIMATE (the travel limiter reduces it at high speed) [D7]. */
  rudderLimit: 10 * DEG,

  disturbance: {
    /** Side gust: sudden change of sideslip, rad. APPROXIMATE, for teaching. */
    gustBeta: 3 * DEG,
    /** Rudder doublet: amplitude (rad) and the length of each half (s). */
    doubletAmp: 5 * DEG,
    doubletHalf: 1.5,
  },

  /**
   * Display only: the 3D rudder is drawn with its deflection multiplied by this factor,
   * because yaw-damper deflections of 1–3° are too small to see. The indicator and the
   * graph show the true value.
   */
  rudderVisualScale: 4,

  /** Integration time step, s (RK4, fixed). */
  dt: 1 / 120,

  /** The linear model is not valid for large motions; the run stops above these, rad. */
  validity: { beta: 20 * DEG, phi: 45 * DEG },
} as const;

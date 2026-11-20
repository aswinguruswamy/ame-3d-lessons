/**
 * Lesson 1 — Magnus effect: all physics values in one place.
 *
 * Every value has a unit, a source, and a note if it is approximate.
 *
 * Sources
 * [S1] ICAO Doc 7488/3, Manual of the ICAO Standard Atmosphere (1993).
 *      Sea-level density 1.225 kg/m³.
 * [S2] J. D. Anderson Jr., Fundamentals of Aerodynamics, 6th ed., McGraw-Hill (2017),
 *      Ch. 3: "Lifting flow over a cylinder" and "The Kutta–Joukowski theorem".
 *      Potential flow = uniform flow + doublet + vortex; L′ = ρ∞·V∞·Γ.
 * [S3] NASA Glenn Research Center, "Lift of a Rotating Cylinder",
 *      https://www.grc.nasa.gov/www/k-12/airplane/cyl.html
 *      Γ = 2π·r·(2π·r·s) for a cylinder of radius r turning at s rev/s,
 *      and Prandtl's limit Γmax = 4π·r·V.
 * [S4] W. M. Swanson, "The Magnus Effect: A Summary of Investigations to Date",
 *      Journal of Basic Engineering 83(3), 461–470 (1961).
 *      Measured lift of real cylinders is lower than ideal theory (viscous effects).
 */

export const MAGNUS = {
  /** Air density, kg/m³. ISA sea level [S1]. Exact by definition of the ISA. */
  rho: 1.225,

  /** Cylinder radius, m. A small wind-tunnel model. Chosen for the lesson (illustrative). */
  radius: 0.05,

  /**
   * Circulation model: Γ = 2π · r² · ω  ("ideal no-slip" estimate) [S3].
   * APPROXIMATE: real flows give less circulation because of viscosity and
   * flow separation [S4]. We use the ideal value so the numbers match the textbook formula.
   */
  circulationModel: 'ideal' as const,

  /**
   * Upper limit of the spin ratio α = ω·r / V used in the lift formula.
   * At α = 2 the two stagnation points meet at the bottom (or top) of the cylinder,
   * so Γmax = 4π·r·V (Prandtl's limit) [S2][S3]. APPROXIMATE (ideal theory).
   */
  maxSpinRatio: 2,

  /** Spin-rate slider, rev/min. */
  rpm: { min: 0, max: 3000, step: 50, default: 2000 },

  /** Airspeed slider, m/s. Low-speed wind-tunnel range (illustrative). */
  airspeed: { min: 2, max: 25, step: 0.5, default: 10 },

  /**
   * Wake deflection used only for the particle picture (not for the lift number).
   * Deflection angle δ = gain · α (radians), limited to ±max.
   * APPROXIMATE, for teaching: ideal potential flow has no wake, so this is a
   * simple visual model of the downwash behind the cylinder.
   */
  wake: { gain: 0.3, maxAngle: 0.55 },

  /**
   * Animation slow-motion factor. Real time is divided by this value so the eye can
   * follow the flow. Flow speed and spin are slowed by the SAME factor, so the
   * spin ratio you see on screen is correct.
   */
  slowMotion: 100,

  /** Time constant for spin-up / spin-down of the animation, seconds (illustrative). */
  spinUpTime: 0.6,

  /** Drawing scales (scene units; 1 scene unit = cylinder radius). */
  draw: {
    /** Lift arrow length per N/m of lift per unit span. */
    liftArrowPerNm: 0.045,
    liftArrowMax: 5.5,
    /** Pressure arrow length per pascal of gauge pressure (p − p∞). */
    pressureArrowPerPa: 0.003,
    pressureArrowMax: 2.4,
    /** Colour scale: Cp at which the colour is fully blue (low) / fully red (high). */
    cpLow: -6,
    cpHigh: 1,
  },
} as const;

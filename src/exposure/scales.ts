/**
 * Discrete camera scales, in 1/3-stop steps.
 *
 * These are the *nominal* values a camera displays, not the exact powers of two.
 * A camera labels 1/8000 s where the true 1/3-stop value is 1/8192, and f/11
 * where the exact value is f/11.31. The largest resulting error is about 0.04
 * stop -- an order of magnitude below anything visible -- and using nominal
 * values means every number this app prints is a number you can actually dial in.
 */

export interface ScaleValue {
  /** Nominal value: seconds for shutter, f-number for aperture, ISO arithmetic speed. */
  readonly value: number;
  /** How the camera displays it: "1/125", "5.6", "3200". */
  readonly label: string;
}

/** Third-stop shutter speeds in seconds, fastest first. */
const SHUTTER_SECONDS: readonly number[] = [
  1 / 32000, 1 / 25000, 1 / 20000, 1 / 16000, 1 / 13000, 1 / 10000,
  1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500,
  1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640,
  1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160,
  1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40,
  1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10,
  1 / 8, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 0.4,
  0.5, 0.6, 0.8, 1, 1.3, 1.6,
  2, 2.5, 3, 4, 5, 6,
  8, 10, 13, 15, 20, 25,
  30, 40, 50, 60, 80, 100,
  120, 160, 200, 240, 320, 400,
  480, 640, 800, 900,
];

/**
 * Label a shutter time the way the camera does.
 *
 * Only speeds of 1/3 s and shorter get written as fractions. Above that the
 * series runs 0.4, 0.5, 0.6, 0.8 -- rounding those to a reciprocal would print
 * 0.4s as "1/3" and 0.8s as "1/1", which is both wrong and a duplicate of a
 * neighbouring entry.
 */
function shutterLabel(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }
  if (seconds >= 1) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}"`;
  if (seconds > 1 / 3) return `${seconds.toFixed(1)}"`;
  return `1/${Math.round(1 / seconds)}`;
}

export const SHUTTER_SCALE: readonly ScaleValue[] = SHUTTER_SECONDS.map((value) => ({
  value,
  label: shutterLabel(value),
}));

/** Third-stop f-numbers, widest first. */
const F_NUMBERS: readonly number[] = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5,
  4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0, 10, 11, 13, 14,
  16, 18, 20, 22, 25, 29, 32, 36, 40, 45,
];

export const APERTURE_SCALE: readonly ScaleValue[] = F_NUMBERS.map((value) => ({
  value,
  label: value < 10 ? value.toFixed(1) : String(Math.round(value)),
}));

/** Third-stop ISO speeds, slowest first. Covers the X-T3's extended range. */
const ISO_SPEEDS: readonly number[] = [
  80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250,
  1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800,
  16000, 20000, 25600, 32000, 40000, 51200,
];

export const ISO_SCALE: readonly ScaleValue[] = ISO_SPEEDS.map((value) => ({
  value,
  label: String(value),
}));

/**
 * Nearest value on a scale, plus how far off it is in stops.
 *
 * `errorStops` is signed in *exposure* terms: positive means the snapped
 * setting lets in more light than the exact answer (a touch over-exposed).
 */
export function snap(
  scale: readonly ScaleValue[],
  exact: number,
  stopsPerUnit: (a: number, b: number) => number,
): { value: ScaleValue; errorStops: number } {
  let best = scale[0]!;
  let bestError = Math.abs(stopsPerUnit(best.value, exact));
  for (const candidate of scale) {
    const error = Math.abs(stopsPerUnit(candidate.value, exact));
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return { value: best, errorStops: stopsPerUnit(best.value, exact) };
}

/** Stops of exposure difference between two shutter times: longer = more light. */
export const shutterStops = (a: number, b: number): number => Math.log2(a / b);

/** Stops between two f-numbers: smaller f-number = more light. */
export const apertureStops = (a: number, b: number): number => 2 * Math.log2(b / a);

/** Stops between two ISO speeds: higher ISO = more exposure. */
export const isoStops = (a: number, b: number): number => Math.log2(a / b);

export type ScaleKind = 'shutter' | 'aperture' | 'iso';

/**
 * Whether a value sits on a whole stop, so the dial can engrave it more boldly.
 * Measured against the exact grid rather than a hardcoded list, so it keeps
 * working if the scales are extended.
 */
export function isFullStop(value: number, kind: ScaleKind): boolean {
  const stops =
    kind === 'aperture' ? 2 * Math.log2(value) : kind === 'iso' ? Math.log2(value / 100) : Math.log2(value);
  return Math.abs(stops - Math.round(stops)) < 0.12;
}

/** Index of the value on `scale` closest to `value`. */
export function indexOfNearest(scale: readonly ScaleValue[], value: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < scale.length; i += 1) {
    const distance = Math.abs(Math.log2(scale[i]!.value / value));
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

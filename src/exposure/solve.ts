/**
 * Incident-light exposure maths.
 *
 * From ISO 2720 (and https://en.wikipedia.org/wiki/Exposure_value), an
 * incident-light meter relates illuminance E in lux to the exposure settings by
 *
 *     N^2 / t = E * S / C
 *
 * where N is the f-number, t the shutter time in seconds, S the ISO arithmetic
 * speed and C the meter calibration constant. Taking log2 of both sides gives a
 * single exposure value that every combination of settings must hit:
 *
 *     EV = log2(E * S / C)
 *
 * The whole app is that one line, plus the business of snapping the answer to
 * settings the camera can actually be set to.
 */

import {
  APERTURE_SCALE,
  ISO_SCALE,
  SHUTTER_SCALE,
  apertureStops,
  isoStops,
  shutterStops,
  snap,
  type ScaleValue,
} from './scales.js';
import type { BodyProfile, LensProfile } from './camera.js';

export type SolveFor = 'shutter' | 'aperture' | 'iso';

export interface MeterState {
  /** Illuminance read off the handheld meter, in lux. */
  readonly lux: number;
  /** Meter calibration constant C. */
  readonly calibration: number;
  readonly iso: number;
  readonly aperture: number;
  readonly shutter: number;
  /** Exposure compensation in stops; positive is a brighter picture. */
  readonly compensation: number;
  /** Density of any ND filter, in stops. */
  readonly ndStops: number;
  /** Allow the faster speeds of the electronic shutter. */
  readonly electronicShutter: boolean;
  /** Allow ISO values outside the native range. */
  readonly extendedIso: boolean;
  /** Allow the long exposures only reachable in M/T. */
  readonly longExposures: boolean;
}

/** EV at the given ISO: the quantity every valid settings triple must equal. */
export function exposureValue(lux: number, iso: number, calibration: number): number {
  return Math.log2((lux * iso) / calibration);
}

/** EV referenced to ISO 100, which is what a meter EV scale traditionally shows. */
export function ev100(lux: number, calibration: number): number {
  return exposureValue(lux, 100, calibration);
}

/**
 * The EV the *settings* must produce, after compensation and any ND filter.
 * More compensation means more light on the sensor, so it lowers the target.
 */
export function targetEv(state: MeterState): number {
  return (
    exposureValue(state.lux, state.iso, state.calibration) -
    state.compensation -
    state.ndStops
  );
}

export type SolutionStatus = 'ok' | 'too-much-light' | 'too-little-light';

export interface Solution {
  readonly solveFor: SolveFor;
  /** The unrounded answer, before snapping to a real camera setting. */
  readonly exact: number;
  /** The setting to dial in: the closest available one. */
  readonly setting: ScaleValue;
  /** Signed stops the recommended setting differs from exact; + is brighter. */
  readonly errorStops: number;
  readonly status: SolutionStatus;
  /** EV the settings are working to. */
  readonly ev: number;
}

/** Shutter speeds this body can reach under the current options. */
export function availableShutters(
  body: BodyProfile,
  state: Pick<MeterState, 'electronicShutter' | 'longExposures'>,
): readonly ScaleValue[] {
  const fastest = state.electronicShutter ? body.electronicFastest : body.mechanicalFastest;
  const slowest = state.longExposures ? body.manualSlowest : body.autoSlowest;
  // Compare with a tolerance so nominal values (1/8000 vs the exact 1/8192) survive.
  return SHUTTER_SCALE.filter((s) => s.value >= fastest * 0.98 && s.value <= slowest * 1.02);
}

/** F-numbers the mounted lens can reach. */
export function availableApertures(lens: LensProfile): readonly ScaleValue[] {
  return APERTURE_SCALE.filter(
    (a) => a.value >= lens.fastest * 0.98 && a.value <= lens.slowest * 1.02,
  );
}

/** ISO speeds this body can be set to under the current options. */
export function availableIsos(
  body: BodyProfile,
  state: Pick<MeterState, 'extendedIso'>,
): readonly ScaleValue[] {
  const min = state.extendedIso ? body.extendedIsoMin : body.nativeIsoMin;
  const max = state.extendedIso ? body.extendedIsoMax : body.nativeIsoMax;
  return ISO_SCALE.filter((i) => i.value >= min && i.value <= max);
}

/**
 * Solve for the one setting the photographer has not fixed.
 *
 * When the answer falls off the end of what the camera can do, the nearest
 * reachable setting is still returned, together with a status saying which way
 * the picture will go. That is the case where you reach for an ND or a tripod,
 * and it is exactly the case the previous version crashed on.
 */
export function solve(
  state: MeterState,
  solveFor: SolveFor,
  body: BodyProfile,
  lens: LensProfile,
): Solution {
  const ev = targetEv(state);
  const factor = 2 ** ev;

  switch (solveFor) {
    case 'shutter': {
      const exact = state.aperture ** 2 / factor;
      const scale = availableShutters(body, state);
      const result = snap(scale, exact, shutterStops);
      const fastest = scale[0]?.value ?? 0;
      const slowest = scale[scale.length - 1]?.value ?? Infinity;
      const status: SolutionStatus =
        exact < fastest * 0.94
          ? 'too-much-light'
          : exact > slowest * 1.06
            ? 'too-little-light'
            : 'ok';
      return { solveFor, exact, setting: result.value, errorStops: result.errorStops, status, ev };
    }
    case 'aperture': {
      const exact = Math.sqrt(state.shutter * factor);
      const scale = availableApertures(lens);
      const result = snap(scale, exact, apertureStops);
      const widest = scale[0]?.value ?? 0;
      const narrowest = scale[scale.length - 1]?.value ?? Infinity;
      // Needing a smaller hole than the lens has means there is too much light.
      const status: SolutionStatus =
        exact > narrowest * 1.03
          ? 'too-much-light'
          : exact < widest * 0.97
            ? 'too-little-light'
            : 'ok';
      return { solveFor, exact, setting: result.value, errorStops: result.errorStops, status, ev };
    }
    case 'iso': {
      // The two fixed settings pin an EV; the ISO is whatever makes the light match it.
      const settingEv = Math.log2(state.aperture ** 2 / state.shutter);
      const exact =
        (state.calibration * 2 ** (settingEv + state.compensation + state.ndStops)) / state.lux;
      const scale = availableIsos(body, state);
      const result = snap(scale, exact, isoStops);
      const lowest = scale[0]?.value ?? 0;
      const highest = scale[scale.length - 1]?.value ?? Infinity;
      const status: SolutionStatus =
        exact < lowest * 0.97
          ? 'too-much-light'
          : exact > highest * 1.03
            ? 'too-little-light'
            : 'ok';
      return {
        solveFor,
        exact,
        setting: result.value,
        errorStops: result.errorStops,
        status,
        ev: settingEv,
      };
    }
  }
}

export interface EquivalentPair {
  readonly aperture: ScaleValue;
  readonly shutter: ScaleValue;
}

/**
 * Every aperture/shutter pair on the camera scales that hits this EV.
 *
 * This is the row of equivalent exposures the dial on a real meter shows: one
 * reading, many ways to take the picture.
 */
export function equivalentExposures(
  ev: number,
  body: BodyProfile,
  lens: LensProfile,
  state: Pick<MeterState, 'electronicShutter' | 'longExposures'>,
  toleranceStops = 1 / 6,
): EquivalentPair[] {
  const shutters = availableShutters(body, state);
  const pairs: EquivalentPair[] = [];
  for (const aperture of availableApertures(lens)) {
    const exact = aperture.value ** 2 / 2 ** ev;
    const { value, errorStops } = snap(shutters, exact, shutterStops);
    if (Math.abs(errorStops) <= toleranceStops) {
      pairs.push({ aperture, shutter: value });
    }
  }
  return pairs;
}

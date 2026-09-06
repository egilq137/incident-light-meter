/** Body and lens limits. Everything the meter is allowed to recommend lives here. */

export interface BodyProfile {
  readonly id: string;
  readonly name: string;
  /** Fastest mechanical shutter, seconds. */
  readonly mechanicalFastest: number;
  /** Fastest electronic shutter, seconds. */
  readonly electronicFastest: number;
  /** Slowest shutter in P/A/S modes, seconds. */
  readonly autoSlowest: number;
  /** Slowest shutter reachable in M/T, seconds. */
  readonly manualSlowest: number;
  readonly nativeIsoMin: number;
  readonly nativeIsoMax: number;
  readonly extendedIsoMin: number;
  readonly extendedIsoMax: number;
  /** Sensor crop factor, for the 1/focal-length handholding rule. */
  readonly cropFactor: number;
  /** Exposure compensation range in stops. */
  readonly compensationLimit: number;
}

export const X_T3: BodyProfile = {
  id: 'x-t3',
  name: 'Fujifilm X-T3',
  mechanicalFastest: 1 / 8000,
  electronicFastest: 1 / 32000,
  autoSlowest: 4,
  manualSlowest: 900, // 15 minutes, T mode
  nativeIsoMin: 160,
  nativeIsoMax: 12800,
  extendedIsoMin: 80,
  extendedIsoMax: 51200,
  cropFactor: 1.5,
  compensationLimit: 5,
};

export interface LensProfile {
  readonly id: string;
  readonly name: string;
  /** Widest aperture available (smallest f-number). */
  readonly fastest: number;
  /** Narrowest aperture (largest f-number). */
  readonly slowest: number;
  /** Focal length in mm; the wide end for a zoom. */
  readonly focalMin: number;
  /** Focal length in mm; the long end for a zoom, equal to focalMin for a prime. */
  readonly focalMax: number;
  /**
   * Variable-aperture zooms only: the widest aperture at the long end.
   * The meter warns rather than silently assuming you are at the wide end.
   */
  readonly fastestAtTele?: number;
}

export const LENSES: readonly LensProfile[] = [
  { id: 'any', name: 'Any lens', fastest: 1.0, slowest: 32, focalMin: 35, focalMax: 35 },
  { id: 'xf16-14', name: 'XF 16mm f/1.4', fastest: 1.4, slowest: 16, focalMin: 16, focalMax: 16 },
  { id: 'xf18-55', name: 'XF 18-55mm f/2.8-4', fastest: 2.8, slowest: 22, focalMin: 18, focalMax: 55, fastestAtTele: 4 },
  { id: 'xf23-14', name: 'XF 23mm f/1.4', fastest: 1.4, slowest: 16, focalMin: 23, focalMax: 23 },
  { id: 'xf23-2', name: 'XF 23mm f/2', fastest: 2.0, slowest: 16, focalMin: 23, focalMax: 23 },
  { id: 'xf27', name: 'XF 27mm f/2.8', fastest: 2.8, slowest: 16, focalMin: 27, focalMax: 27 },
  { id: 'xf35-14', name: 'XF 35mm f/1.4', fastest: 1.4, slowest: 16, focalMin: 35, focalMax: 35 },
  { id: 'xf35-2', name: 'XF 35mm f/2', fastest: 2.0, slowest: 16, focalMin: 35, focalMax: 35 },
  { id: 'xf56-12', name: 'XF 56mm f/1.2', fastest: 1.2, slowest: 16, focalMin: 56, focalMax: 56 },
  { id: 'xf16-55', name: 'XF 16-55mm f/2.8', fastest: 2.8, slowest: 22, focalMin: 16, focalMax: 55 },
  { id: 'xf50-140', name: 'XF 50-140mm f/2.8', fastest: 2.8, slowest: 22, focalMin: 50, focalMax: 140 },
  { id: 'xf55-200', name: 'XF 55-200mm f/3.5-4.8', fastest: 3.5, slowest: 22, focalMin: 55, focalMax: 200, fastestAtTele: 4.8 },
];

/**
 * Meter calibration constant C, from ISO 2720. The standard permits 250-320 and
 * manufacturers differ, which is the usual reason an app and a handheld meter
 * disagree by a third of a stop. Pick the one that matches the meter on the desk.
 */
export const CALIBRATIONS = [
  { id: 'flat', label: 'Flat diffuser', c: 250, note: 'ISO 2720 value for a flat receptor' },
  { id: 'dome', label: 'Hemispherical dome', c: 320, note: 'ISO 2720 value for a dome' },
  { id: 'sekonic', label: 'Sekonic', c: 340, note: 'What Sekonic calibrates its domes to' },
] as const;

export const DEFAULT_CALIBRATION = 340;

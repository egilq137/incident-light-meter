/**
 * The things a meter cannot tell you but a photographer would: that you need an
 * ND, that this is past handholding, that the lens will not open that wide at
 * 200mm. Pure functions over a solution so they can be tested like the maths.
 */

import type { BodyProfile, LensProfile } from './camera.js';
import type { MeterState, Solution } from './solve.js';

export type NoticeLevel = 'warn' | 'info';

export interface Notice {
  readonly level: NoticeLevel;
  readonly text: string;
}

/** Slowest shutter that is plausibly sharp handheld, by the 1/focal-length rule. */
export function handheldLimit(lens: LensProfile, body: BodyProfile): number {
  return 1 / (lens.focalMax * body.cropFactor);
}

function stopsShort(exact: number, reachable: number, kind: 'shutter' | 'aperture' | 'iso'): number {
  switch (kind) {
    case 'shutter':
      return Math.abs(Math.log2(exact / reachable));
    case 'aperture':
      return Math.abs(2 * Math.log2(exact / reachable));
    case 'iso':
      return Math.abs(Math.log2(exact / reachable));
  }
}

export function advise(
  state: MeterState,
  solution: Solution,
  body: BodyProfile,
  lens: LensProfile,
): Notice[] {
  const notices: Notice[] = [];
  const shutter = solution.solveFor === 'shutter' ? solution.setting.value : state.shutter;

  if (solution.status === 'too-much-light') {
    const short = stopsShort(solution.exact, solution.setting.value, solution.solveFor);
    const nd = Math.max(1, Math.round(short));
    notices.push({
      level: 'warn',
      text:
        solution.solveFor === 'iso'
          ? `Too much light even at ISO ${solution.setting.label}. Close down, use a faster shutter, or add about ${nd} ${nd === 1 ? 'stop' : 'stops'} of ND.`
          : `Too much light by about ${short.toFixed(1)} stops. Add an ND filter of roughly ${nd} ${nd === 1 ? 'stop' : 'stops'}, or drop the ISO.`,
    });
  }

  if (solution.status === 'too-little-light') {
    const short = stopsShort(solution.exact, solution.setting.value, solution.solveFor);
    notices.push({
      level: 'warn',
      text: `Not enough light by about ${short.toFixed(1)} stops. Open up, raise the ISO, or switch on long exposures for the slower speeds.`,
    });
  }

  if (Math.abs(solution.errorStops) > 1 / 6) {
    const direction = solution.errorStops > 0 ? 'over' : 'under';
    notices.push({
      level: 'info',
      text: `Nearest setting is ${Math.abs(solution.errorStops).toFixed(2)} stop ${direction}. Nudge exposure compensation if it matters.`,
    });
  }

  const limit = handheldLimit(lens, body);
  if (shutter > limit * 1.05) {
    notices.push({
      level: 'warn',
      text: `${formatSeconds(shutter)} is slower than the ${formatSeconds(limit)} handholding rule for ${lens.focalMax}mm. Use a tripod or brace up.`,
    });
  }

  const aperture = solution.solveFor === 'aperture' ? solution.setting.value : state.aperture;
  if (lens.fastestAtTele !== undefined && aperture < lens.fastestAtTele * 0.98) {
    notices.push({
      level: 'info',
      text: `f/${aperture} is only available at the wide end of the ${lens.name}; it stops down to f/${lens.fastestAtTele} at ${lens.focalMax}mm.`,
    });
  }

  if (aperture > 11) {
    notices.push({
      level: 'info',
      text: `Past about f/11 on the X-T3 diffraction starts to soften fine detail.`,
    });
  }

  if (state.electronicShutter && shutter > 1) {
    notices.push({
      level: 'info',
      text: `The electronic shutter buys you speed, not long exposures. Turn it off for anything past a second.`,
    });
  }

  return notices;
}

function formatSeconds(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

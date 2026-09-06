import { describe, expect, it } from 'vitest';
import { X_T3, LENSES, type LensProfile } from '../src/exposure/camera.js';
import {
  APERTURE_SCALE,
  ISO_SCALE,
  SHUTTER_SCALE,
  apertureStops,
  isoStops,
  shutterStops,
} from '../src/exposure/scales.js';
import {
  availableIsos,
  availableShutters,
  equivalentExposures,
  exposureValue,
  solve,
  targetEv,
  type MeterState,
} from '../src/exposure/solve.js';
import { advise, handheldLimit } from '../src/exposure/advice.js';

const anyLens = LENSES.find((l) => l.id === 'any') as LensProfile;
const zoom = LENSES.find((l) => l.id === 'xf50-140') as LensProfile;

const base: MeterState = {
  lux: 10000,
  calibration: 250,
  iso: 100,
  aperture: 8,
  shutter: 1 / 125,
  compensation: 0,
  ndStops: 0,
  electronicShutter: false,
  extendedIso: true,
  longExposures: true,
};

const state = (overrides: Partial<MeterState> = {}): MeterState => ({ ...base, ...overrides });

describe('exposure value', () => {
  it('puts full sunlight at EV 15 for ISO 100', () => {
    // Sunny 16: EV100 = 15 is roughly 111,000 lux with a dome-calibrated meter.
    const lux = (340 * 2 ** 15) / 100;
    expect(exposureValue(lux, 100, 340)).toBeCloseTo(15, 6);
  });

  it('gains a stop when the ISO doubles', () => {
    const a = exposureValue(1000, 100, 250);
    const b = exposureValue(1000, 200, 250);
    expect(b - a).toBeCloseTo(1, 10);
  });

  it('loses a stop when the calibration constant doubles', () => {
    const a = exposureValue(1000, 100, 250);
    const b = exposureValue(1000, 100, 500);
    expect(a - b).toBeCloseTo(1, 10);
  });

  it('lowers the target EV by the exposure compensation', () => {
    expect(targetEv(state({ compensation: 0 })) - targetEv(state({ compensation: 1 }))).toBeCloseTo(
      1,
      10,
    );
  });

  it('lowers the target EV by the ND density', () => {
    expect(targetEv(state({ ndStops: 0 })) - targetEv(state({ ndStops: 3 }))).toBeCloseTo(3, 10);
  });
});

describe('solving for shutter speed', () => {
  it('reproduces sunny 16: f/16, ISO 100, full sun gives 1/125', () => {
    const lux = (340 * 2 ** 15) / 100;
    const result = solve(
      state({ lux, calibration: 340, iso: 100, aperture: 16 }),
      'shutter',
      X_T3,
      anyLens,
    );
    expect(result.setting.label).toBe('1/125');
    expect(result.status).toBe('ok');
  });

  it('halves the time when the ISO doubles', () => {
    const slow = solve(state({ iso: 200 }), 'shutter', X_T3, anyLens);
    const fast = solve(state({ iso: 400 }), 'shutter', X_T3, anyLens);
    expect(shutterStops(slow.exact, fast.exact)).toBeCloseTo(1, 10);
  });

  it('halves the time when the lens opens one stop', () => {
    const closed = solve(state({ aperture: 8 }), 'shutter', X_T3, anyLens);
    const open = solve(state({ aperture: 5.6 }), 'shutter', X_T3, anyLens);
    expect(shutterStops(closed.exact, open.exact)).toBeCloseTo(1, 1);
  });

  it('doubles the time for +1 stop of exposure compensation', () => {
    const normal = solve(state(), 'shutter', X_T3, anyLens);
    const brighter = solve(state({ compensation: 1 }), 'shutter', X_T3, anyLens);
    expect(shutterStops(brighter.exact, normal.exact)).toBeCloseTo(1, 10);
  });

  it('lengthens the time eightfold behind a 3-stop ND', () => {
    const bare = solve(state(), 'shutter', X_T3, anyLens);
    const filtered = solve(state({ ndStops: 3 }), 'shutter', X_T3, anyLens);
    expect(shutterStops(filtered.exact, bare.exact)).toBeCloseTo(3, 10);
  });

  it('never lands further than a sixth of a stop from exact while in range', () => {
    for (const lux of [50, 500, 5000, 50000]) {
      const result = solve(state({ lux }), 'shutter', X_T3, anyLens);
      if (result.status === 'ok') expect(Math.abs(result.errorStops)).toBeLessThanOrEqual(1 / 6);
    }
  });
});

describe('solving for aperture and ISO', () => {
  it('round-trips: solve for shutter, then that shutter gives back the aperture', () => {
    const forward = solve(state({ aperture: 5.6 }), 'shutter', X_T3, anyLens);
    const back = solve(
      state({ aperture: 5.6, shutter: forward.setting.value }),
      'aperture',
      X_T3,
      anyLens,
    );
    expect(Math.abs(apertureStops(back.setting.value, 5.6))).toBeLessThanOrEqual(1 / 3);
  });

  it('round-trips through ISO', () => {
    const forward = solve(state({ iso: 400 }), 'shutter', X_T3, anyLens);
    const back = solve(
      state({ iso: 400, shutter: forward.setting.value }),
      'iso',
      X_T3,
      anyLens,
    );
    expect(Math.abs(isoStops(back.setting.value, 400))).toBeLessThanOrEqual(1 / 3);
  });

  it('needs a wider aperture when the light drops', () => {
    const bright = solve(state({ lux: 20000 }), 'aperture', X_T3, anyLens);
    const dim = solve(state({ lux: 2000 }), 'aperture', X_T3, anyLens);
    expect(dim.exact).toBeLessThan(bright.exact);
  });
});

describe('running out of camera', () => {
  it('reports too much light instead of throwing, and still names a setting', () => {
    const result = solve(state({ lux: 5_000_000, iso: 12800 }), 'shutter', X_T3, anyLens);
    expect(result.status).toBe('too-much-light');
    expect(result.setting.label).toBe('1/8000');
    expect(advise(state({ lux: 5_000_000, iso: 12800 }), result, X_T3, anyLens)[0]?.level).toBe(
      'warn',
    );
  });

  it('reports too little light in near darkness', () => {
    const s = state({ lux: 0.01, iso: 160, aperture: 22, longExposures: false });
    const result = solve(s, 'shutter', X_T3, anyLens);
    expect(result.status).toBe('too-little-light');
    expect(result.setting.label).toBe('4"');
  });

  it('is the case the old Python version crashed on', () => {
    // ShutterSpeed.format_output raised UnboundLocalError whenever the answer
    // fell off either end of its list. Both ends now return a usable setting.
    expect(() => solve(state({ lux: 1e9 }), 'shutter', X_T3, anyLens)).not.toThrow();
    expect(() => solve(state({ lux: 1e-9 }), 'shutter', X_T3, anyLens)).not.toThrow();
  });

  it('opens up the fast end only when the electronic shutter is allowed', () => {
    const mechanical = availableShutters(X_T3, { electronicShutter: false, longExposures: false });
    const electronic = availableShutters(X_T3, { electronicShutter: true, longExposures: false });
    expect(mechanical[0]?.label).toBe('1/8000');
    expect(electronic[0]?.label).toBe('1/32000');
  });
});

describe('camera scales', () => {
  // These scales hold the *nominal* numbers a camera prints, so the gap between
  // neighbours is only approximately a third of a stop: f/11 to f/13 measures
  // 0.48 stops and f/13 to f/14 measures 0.21, because the exact values behind
  // those labels are 11.31, 12.70 and 14.25. Each label sits within about a
  // twentieth of a stop of the true grid, and it is the total span, not the
  // individual gap, that pins down whether a step is missing or duplicated.

  // The final shutter entry, 900s, is the 15-minute T-mode ceiling rather than a
  // step on the grid, so the walks below stop before it.
  const gridCases = [
    { name: 'shutter', scale: SHUTTER_SCALE.slice(0, -1), factor: 1 },
    { name: 'aperture', scale: APERTURE_SCALE, factor: 2 },
    { name: 'iso', scale: ISO_SCALE, factor: 1 },
  ];

  it('rises monotonically in roughly third-stop steps', () => {
    for (const { scale, factor } of gridCases) {
      for (let i = 1; i < scale.length; i += 1) {
        const stops = Math.abs(Math.log2(scale[i]!.value / scale[i - 1]!.value)) * factor;
        expect(stops).toBeGreaterThan(0.15);
        expect(stops).toBeLessThan(0.5);
      }
    }
  });

  it('does not drift: the whole scale spans one third-stop per step', () => {
    for (const { scale, factor } of gridCases) {
      const span = Math.abs(Math.log2(scale[scale.length - 1]!.value / scale[0]!.value)) * factor;
      expect(Math.abs(span - (scale.length - 1) / 3)).toBeLessThan(0.25);
    }
  });

  it('keeps every nominal label within a tenth of a stop of the exact grid', () => {
    for (const { scale, factor } of gridCases) {
      for (let i = 0; i < scale.length; i += 1) {
        const exact = Math.abs(Math.log2(scale[i]!.value / scale[0]!.value)) * factor;
        expect(Math.abs(exact - i / 3)).toBeLessThan(0.25);
      }
    }
  });

  it('labels shutter speeds the way the camera does', () => {
    const labels = SHUTTER_SCALE.map((s) => s.label);
    expect(labels).toContain('1/125');
    expect(labels).toContain('1/8000');
    expect(labels).toContain('1"');
    expect(labels).toContain('30"');
    expect(labels).toContain('15m');
    // The sub-second decimals: rounding these to a reciprocal printed 0.4s as
    // "1/3" and 0.8s as "1/1", colliding with their neighbours.
    expect(labels).toContain('0.4"');
    expect(labels).toContain('0.8"');
    expect(labels).toContain('1m 20s');
  });

  it('gives every value on every scale a distinct label', () => {
    for (const scale of [SHUTTER_SCALE, APERTURE_SCALE, ISO_SCALE]) {
      const labels = scale.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('respects the native ISO floor of 160 unless extended ISO is on', () => {
    expect(availableIsos(X_T3, { extendedIso: false })[0]?.value).toBe(160);
    expect(availableIsos(X_T3, { extendedIso: true })[0]?.value).toBe(80);
  });
});

describe('equivalent exposures', () => {
  it('gives combinations that all land on the same EV', () => {
    const ev = targetEv(state());
    const pairs = equivalentExposures(ev, X_T3, anyLens, base);
    expect(pairs.length).toBeGreaterThan(5);
    for (const pair of pairs) {
      const pairEv = Math.log2(pair.aperture.value ** 2 / pair.shutter.value);
      expect(Math.abs(pairEv - ev)).toBeLessThanOrEqual(1 / 6 + 1e-9);
    }
  });

  it('is limited by the lens', () => {
    const ev = targetEv(state());
    const wide = equivalentExposures(ev, X_T3, anyLens, base);
    const limited = equivalentExposures(ev, X_T3, zoom, base);
    expect(limited.length).toBeLessThan(wide.length);
    expect(limited.every((p) => p.aperture.value >= 2.8)).toBe(true);
  });
});

describe('advice', () => {
  it('warns below the handholding limit', () => {
    const limit = handheldLimit(zoom, X_T3);
    expect(limit).toBeCloseTo(1 / 210, 6);
    const s = state({ lux: 20, iso: 160, aperture: 2.8 });
    const result = solve(s, 'shutter', X_T3, zoom);
    expect(advise(s, result, X_T3, zoom).some((n) => n.text.includes('handholding'))).toBe(true);
  });

  it('flags a variable-aperture zoom that cannot hold f/2.8 at the long end', () => {
    const kit = LENSES.find((l) => l.id === 'xf55-200') as LensProfile;
    const s = state({ aperture: 3.5 });
    const result = solve(s, 'shutter', X_T3, kit);
    expect(advise(s, result, X_T3, kit).some((n) => n.text.includes('wide end'))).toBe(true);
  });
});

describe('the scenario from the original calculator.feature', () => {
  it('gives 1/40 at 1000 lux, ISO 100, f/2.8 -- not the 1/500 the feature file claimed', () => {
    const result = solve(
      state({ lux: 1000, iso: 100, aperture: 2.8, calibration: 340 }),
      'shutter',
      X_T3,
      anyLens,
    );
    expect(result.setting.label).toBe('1/40');
  });
});

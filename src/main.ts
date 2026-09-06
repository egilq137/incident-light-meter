import './styles.css';

import { CALIBRATIONS, DEFAULT_CALIBRATION, LENSES, X_T3, type LensProfile } from './exposure/camera.js';
import { indexOfNearest, type ScaleValue } from './exposure/scales.js';
import {
  availableApertures,
  availableIsos,
  availableShutters,
  equivalentExposures,
  ev100,
  solve,
  targetEv,
  type MeterState,
  type SolveFor,
} from './exposure/solve.js';
import { advise } from './exposure/advice.js';
import { createGauge } from './ui/gauge.js';
import { createDial } from './ui/dial.js';

/** The stored state is the meter reading plus the two things it does not know. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type AppState = Mutable<MeterState> & {
  solveFor: SolveFor;
  lensId: string;
};

const STORAGE_KEY = 'incident-light-meter/state/1';

const defaults: AppState = {
  lux: 10000,
  calibration: DEFAULT_CALIBRATION,
  iso: 400,
  aperture: 5.6,
  shutter: 1 / 125,
  compensation: 0,
  ndStops: 0,
  electronicShutter: false,
  extendedIso: false,
  longExposures: true,
  solveFor: 'shutter',
  lensId: 'any',
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<AppState>;
    // Merge rather than trust: a stored shape from an older version must not
    // leave the app with undefined settings.
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

function save(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing, or storage disabled. The app still works for this session.
  }
}

let state = load();

const $ = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  return node;
};

const lcd = $<HTMLElement>('.lcd');
const lcdLabel = $<HTMLElement>('#lcd-label');
const lcdValue = $<HTMLElement>('#lcd-value');
const lcdContext = $<HTMLElement>('#lcd-context');
const lcdDrift = $<HTMLElement>('#lcd-drift');
const lcdEv = $<HTMLElement>('#lcd-ev');
const luxInput = $<HTMLInputElement>('#lux');
const noticesMount = $<HTMLElement>('#notices');
const equivalentsMount = $<HTMLElement>('#equivalents');

const gauge = createGauge($<HTMLElement>('#gauge-mount'));

function currentLens(): LensProfile {
  return LENSES.find((l) => l.id === state.lensId) ?? LENSES[0]!;
}

/* ------------------------------------------------------------------ dials */

const dialEls = {
  aperture: $<HTMLElement>('[data-dial="aperture"]'),
  shutter: $<HTMLElement>('[data-dial="shutter"]'),
  iso: $<HTMLElement>('[data-dial="iso"]'),
};

const dials = {
  aperture: createDial(
    dialEls.aperture.querySelector('[data-dial-track]') as HTMLElement,
    'aperture',
    (index) => {
      const scale = availableApertures(currentLens());
      state.aperture = scale[index]?.value ?? state.aperture;
      if (state.solveFor === 'aperture') state.solveFor = 'shutter';
      render();
    },
  ),
  shutter: createDial(
    dialEls.shutter.querySelector('[data-dial-track]') as HTMLElement,
    'shutter',
    (index) => {
      const scale = availableShutters(X_T3, state);
      state.shutter = scale[index]?.value ?? state.shutter;
      if (state.solveFor === 'shutter') state.solveFor = 'aperture';
      render();
    },
  ),
  iso: createDial(
    dialEls.iso.querySelector('[data-dial-track]') as HTMLElement,
    'iso',
    (index) => {
      const scale = availableIsos(X_T3, state);
      state.iso = scale[index]?.value ?? state.iso;
      if (state.solveFor === 'iso') state.solveFor = 'shutter';
      render();
    },
  ),
};

/* --------------------------------------------------------------- controls */

luxInput.addEventListener('input', () => {
  const value = Number(luxInput.value);
  if (Number.isFinite(value) && value > 0) {
    state.lux = value;
    render({ skipLux: true });
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lux-step]')) {
  button.addEventListener('click', () => {
    const direction = Number(button.dataset['luxStep']);
    // Light is logarithmic, so the step buttons move a third of a stop.
    const stepped = state.lux * 2 ** (direction / 3);
    state.lux = Number(stepped.toPrecision(3));
    render();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-solve]')) {
  button.addEventListener('click', () => {
    state.solveFor = button.dataset['solve'] as SolveFor;
    render();
  });
}

const settingsPanel = $<HTMLElement>('#settings');
const settingsToggle = $<HTMLButtonElement>('#settings-toggle');
settingsToggle.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
});

const lensSelect = $<HTMLSelectElement>('#lens');
lensSelect.replaceChildren(
  ...LENSES.map((lens) => new Option(lens.name, lens.id, false, lens.id === state.lensId)),
);
lensSelect.addEventListener('change', () => {
  state.lensId = lensSelect.value;
  const scale = availableApertures(currentLens());
  // Keep the aperture inside what the new lens can do.
  state.aperture = scale[indexOfNearest(scale, state.aperture)]?.value ?? state.aperture;
  render();
});

const calibrationSelect = $<HTMLSelectElement>('#calibration');
calibrationSelect.replaceChildren(
  ...CALIBRATIONS.map(
    (entry) =>
      new Option(`${entry.label} - C ${entry.c}`, String(entry.c), false, entry.c === state.calibration),
  ),
);
calibrationSelect.addEventListener('change', () => {
  state.calibration = Number(calibrationSelect.value);
  render();
});

const compensationInput = $<HTMLInputElement>('#compensation');
compensationInput.addEventListener('input', () => {
  // Snap to thirds so the readout matches the camera dial.
  state.compensation = Math.round(Number(compensationInput.value) * 3) / 3;
  render();
});

const ndInput = $<HTMLInputElement>('#nd');
ndInput.addEventListener('input', () => {
  state.ndStops = Number(ndInput.value);
  render();
});

const toggles: ReadonlyArray<[string, keyof AppState]> = [
  ['#electronic', 'electronicShutter'],
  ['#extended', 'extendedIso'],
  ['#long', 'longExposures'],
];
for (const [selector, key] of toggles) {
  const input = $<HTMLInputElement>(selector);
  input.addEventListener('change', () => {
    (state as unknown as Record<string, unknown>)[key] = input.checked;
    render();
  });
}

/* ----------------------------------------------------------------- render */

function formatStops(stops: number): string {
  const rounded = Math.round(stops * 3) / 3;
  if (Math.abs(rounded) < 0.01) return '0';
  const thirds = Math.round(Math.abs(rounded) * 3);
  const whole = Math.floor(thirds / 3);
  const remainder = thirds % 3;
  const sign = rounded > 0 ? '+' : '-';
  if (remainder === 0) return `${sign}${whole}`;
  return `${sign}${whole === 0 ? '' : `${whole} `}${remainder}/3`;
}

function render(options: { skipLux?: boolean } = {}): void {
  const lens = currentLens();

  // Scales first: what the body and lens allow constrains everything below.
  const apertureScale = availableApertures(lens);
  const shutterScale = availableShutters(X_T3, state);
  const isoScale = availableIsos(X_T3, state);

  dials.aperture.setScale(apertureScale, state.aperture);
  dials.shutter.setScale(shutterScale, state.shutter);
  dials.iso.setScale(isoScale, state.iso);

  const solution = solve(state, state.solveFor, X_T3, lens);

  // Show the solved setting on its own dial, so all three always agree.
  const solvedScale: readonly ScaleValue[] =
    state.solveFor === 'shutter' ? shutterScale : state.solveFor === 'aperture' ? apertureScale : isoScale;
  dials[state.solveFor].select(indexOfNearest(solvedScale, solution.setting.value));

  for (const key of ['aperture', 'shutter', 'iso'] as const) {
    dialEls[key].dataset['driven'] = String(key === state.solveFor);
    const readout = dialEls[key].querySelector('[data-dial-value]') as HTMLElement;
    const value =
      key === state.solveFor
        ? solution.setting
        : key === 'aperture'
          ? apertureScale[indexOfNearest(apertureScale, state.aperture)]
          : key === 'shutter'
            ? shutterScale[indexOfNearest(shutterScale, state.shutter)]
            : isoScale[indexOfNearest(isoScale, state.iso)];
    readout.textContent = key === 'aperture' ? `f/${value?.label ?? ''}` : (value?.label ?? '');
  }

  // The big readout.
  const shownAperture = state.solveFor === 'aperture' ? solution.setting.label : String(state.aperture);
  const shownShutter =
    state.solveFor === 'shutter'
      ? solution.setting.label
      : (shutterScale[indexOfNearest(shutterScale, state.shutter)]?.label ?? '');
  const shownIso = state.solveFor === 'iso' ? solution.setting.label : String(state.iso);

  lcd.dataset['status'] = solution.status;
  lcdLabel.textContent =
    state.solveFor === 'shutter' ? 'Shutter' : state.solveFor === 'aperture' ? 'Aperture' : 'ISO';
  lcdValue.textContent =
    state.solveFor === 'aperture' ? `f/${solution.setting.label}` : solution.setting.label;
  lcdContext.textContent =
    state.solveFor === 'shutter'
      ? `f/${shownAperture} · ISO ${shownIso}`
      : state.solveFor === 'aperture'
        ? `${shownShutter} · ISO ${shownIso}`
        : `f/${shownAperture} · ${shownShutter}`;

  const light = ev100(state.lux, state.calibration);
  lcdEv.textContent = `EV ${light.toFixed(1)}`;
  lcdDrift.textContent =
    Math.abs(solution.errorStops) < 0.02
      ? 'exact'
      : `${formatStops(solution.errorStops)} stop from exact`;

  // Needle shows the light itself, referenced to ISO 100 like a real meter.
  gauge.setEv(light);

  // Shade the light levels this camera and lens can still expose correctly.
  const isoOffset = Math.log2(state.iso / 100) - state.compensation - state.ndStops;
  const settingEvs = [
    Math.log2((apertureScale[0]?.value ?? 1) ** 2 / (shutterScale[shutterScale.length - 1]?.value ?? 1)),
    Math.log2(
      (apertureScale[apertureScale.length - 1]?.value ?? 1) ** 2 / (shutterScale[0]?.value ?? 1),
    ),
  ];
  gauge.setReachable(settingEvs[0]! - isoOffset, settingEvs[1]! - isoOffset);

  if (!options.skipLux) luxInput.value = String(state.lux);

  // Advice.
  const notices = advise(state, solution, X_T3, lens);
  noticesMount.replaceChildren(
    ...notices.map((notice) => {
      const row = document.createElement('p');
      row.className = 'notice';
      row.dataset['level'] = notice.level;
      row.textContent = notice.text;
      return row;
    }),
  );

  // Equivalent exposures at this reading.
  const ev = state.solveFor === 'iso' ? solution.ev : targetEv(state);
  const pairs = equivalentExposures(ev, X_T3, currentLens(), state);
  equivalentsMount.replaceChildren(
    ...pairs.map((pair) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'equivalent';
      const isCurrent =
        Math.abs(pair.aperture.value - Number(shownAperture)) < 0.05 &&
        pair.shutter.label === shownShutter;
      card.setAttribute('aria-current', String(isCurrent));
      card.innerHTML = `<span>f/${pair.aperture.label}</span><small>${pair.shutter.label}</small>`;
      card.addEventListener('click', () => {
        state.aperture = pair.aperture.value;
        state.shutter = pair.shutter.value;
        if (state.solveFor === 'iso') state.solveFor = 'shutter';
        render();
      });
      return card;
    }),
  );

  // Bring the current combination into view, but only when it has drifted out:
  // scrolling on every render fights the user as they drag the strip.
  const currentCard = equivalentsMount.querySelector<HTMLElement>('[aria-current="true"]');
  if (currentCard) {
    const left = currentCard.offsetLeft - equivalentsMount.scrollLeft;
    if (left < 0 || left + currentCard.offsetWidth > equivalentsMount.clientWidth) {
      equivalentsMount.scrollTo({
        left: currentCard.offsetLeft - (equivalentsMount.clientWidth - currentCard.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }

  // Reflect state into the controls that are not the source of this change.
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-solve]')) {
    button.setAttribute('aria-checked', String(button.dataset['solve'] === state.solveFor));
  }
  compensationInput.value = String(state.compensation);
  $<HTMLElement>('#compensation-value').textContent = `${formatStops(state.compensation)} EV`;
  ndInput.value = String(state.ndStops);
  $<HTMLElement>('#nd-value').textContent =
    state.ndStops === 0 ? 'none' : `${state.ndStops} ${state.ndStops === 1 ? 'stop' : 'stops'}`;
  $<HTMLElement>('#calibration-note').textContent =
    CALIBRATIONS.find((c) => c.c === state.calibration)?.note ?? '';
  $<HTMLInputElement>('#electronic').checked = state.electronicShutter;
  $<HTMLInputElement>('#extended').checked = state.extendedIso;
  $<HTMLInputElement>('#long').checked = state.longExposures;
  $<HTMLElement>('#body-name').textContent = `${X_T3.name} · ${lens.name}`;

  save(state);
}

render();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

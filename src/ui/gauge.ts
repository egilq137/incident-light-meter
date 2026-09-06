/**
 * The analogue face: an engraved EV arc with a needle that swings to the
 * reading. Drawn as SVG so it stays sharp, and animated with a slightly
 * overshooting easing so it settles the way a real movement does.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const EV_MIN = -2;
const EV_MAX = 20;
const SWEEP = 75; // degrees either side of vertical
const CX = 210;
const CY = 186;
const R = 156;

function angleForEv(ev: number): number {
  const clamped = Math.max(EV_MIN, Math.min(EV_MAX, ev));
  const t = (clamped - EV_MIN) / (EV_MAX - EV_MIN);
  return -SWEEP + t * SWEEP * 2;
}

function pointAt(angleDeg: number, radius: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.sin(a), CY - radius * Math.cos(a)];
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function arcPath(fromEv: number, toEv: number, radius: number): string {
  const [x1, y1] = pointAt(angleForEv(fromEv), radius);
  const [x2, y2] = pointAt(angleForEv(toEv), radius);
  const large = Math.abs(angleForEv(toEv) - angleForEv(fromEv)) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

export interface Gauge {
  /** Swing the needle to an EV. */
  setEv(ev: number): void;
  /** Shade the span of EV the current body, lens and ISO can actually reach. */
  setReachable(fromEv: number, toEv: number): void;
}

export function createGauge(mount: HTMLElement): Gauge {
  const svg = el('svg', { viewBox: '0 0 420 212', role: 'img' });
  svg.setAttribute('aria-label', 'Exposure value dial');

  const defs = el('defs', {});
  defs.innerHTML = `
    <linearGradient id="faceGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#20242b"/>
      <stop offset="100%" stop-color="#121519"/>
    </linearGradient>
    <radialGradient id="capGradient" cx="35%" cy="30%">
      <stop offset="0%" stop-color="#5b626d"/>
      <stop offset="100%" stop-color="#20242a"/>
    </radialGradient>
    <linearGradient id="needleGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff7a6d"/>
      <stop offset="100%" stop-color="#c9372b"/>
    </linearGradient>`;
  svg.append(defs);

  // Recessed face: the ring between two radii, closed across both ends.
  const outer = R + 16;
  const inner = R - 44;
  const [ox1, oy1] = pointAt(angleForEv(EV_MIN), outer);
  const [ox2, oy2] = pointAt(angleForEv(EV_MAX), outer);
  const [ix1, iy1] = pointAt(angleForEv(EV_MIN), inner);
  const [ix2, iy2] = pointAt(angleForEv(EV_MAX), inner);
  svg.append(
    el('path', {
      class: 'gauge__face',
      d:
        `M ${ox1} ${oy1} A ${outer} ${outer} 0 0 1 ${ox2} ${oy2} ` +
        `L ${ix2} ${iy2} A ${inner} ${inner} 0 0 0 ${ix1} ${iy1} Z`,
    }),
  );

  const reachable = el('path', {
    class: 'gauge__band',
    stroke: 'rgba(125, 255, 176, 0.28)',
    'stroke-width': 5,
    d: arcPath(EV_MIN, EV_MAX, R - 3),
  });
  svg.append(reachable);

  // Ticks and numerals, engraved every stop, numbered every other stop.
  for (let ev = EV_MIN; ev <= EV_MAX; ev += 1) {
    const major = ev % 2 === 0;
    const angle = angleForEv(ev);
    const [x1, y1] = pointAt(angle, R - 10);
    const [x2, y2] = pointAt(angle, major ? R - 24 : R - 18);
    svg.append(
      el('line', {
        class: major ? 'gauge__tick gauge__tick--major' : 'gauge__tick',
        x1,
        y1,
        x2,
        y2,
        'stroke-width': major ? 2 : 1,
        'stroke-linecap': 'round',
      }),
    );
    if (major) {
      const [lx, ly] = pointAt(angle, R - 36);
      const label = el('text', { class: 'gauge__label', x: lx, y: ly + 3 });
      label.textContent = String(ev);
      svg.append(label);
    }
  }

  // Below the pivot, clear of the needle sweep.
  const unit = el('text', { class: 'gauge__label', x: CX, y: CY + 20 });
  unit.textContent = 'EV 100';
  svg.append(unit);

  const needle = el('path', {
    class: 'gauge__needle',
    fill: 'url(#needleGradient)',
    d: `M ${CX - 4} ${CY} L ${CX - 1.2} ${CY - R + 12} L ${CX + 1.2} ${CY - R + 12} L ${CX + 4} ${CY} Z`,
  });
  needle.style.transformOrigin = `${CX}px ${CY}px`;
  needle.style.transformBox = 'view-box';
  svg.append(needle);

  svg.append(el('circle', { class: 'gauge__cap', cx: CX, cy: CY, r: 11 }));
  svg.append(el('circle', { cx: CX, cy: CY, r: 3, fill: '#0d0f12' }));

  mount.replaceChildren(svg);

  return {
    setEv(ev) {
      needle.style.transform = `rotate(${angleForEv(ev).toFixed(2)}deg)`;
    },
    setReachable(fromEv, toEv) {
      const lo = Math.max(EV_MIN, Math.min(fromEv, toEv));
      const hi = Math.min(EV_MAX, Math.max(fromEv, toEv));
      if (hi <= lo) {
        reachable.setAttribute('d', '');
        return;
      }
      reachable.setAttribute('d', arcPath(lo, hi, R - 3));
    },
  };
}

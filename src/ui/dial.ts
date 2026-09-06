/**
 * A knurled strip you drag sideways, detented onto the camera scale.
 *
 * CSS scroll snapping does the detenting, which means the control keeps native
 * momentum and rubber-banding on a phone -- important, because this is the part
 * you use one-handed with a camera in the other.
 */

import { indexOfNearest, isFullStop, type ScaleKind, type ScaleValue } from '../exposure/scales.js';

export interface Dial {
  /** Replace the values, keeping the selection near `value` if it still exists. */
  setScale(scale: readonly ScaleValue[], value: number): void;
  /** Move the pointer without reporting a change back. */
  select(index: number, animate?: boolean): void;
  readonly index: number;
}

export function createDial(
  track: HTMLElement,
  kind: ScaleKind,
  onChange: (index: number) => void,
): Dial {
  let scale: readonly ScaleValue[] = [];
  let index = 0;
  let programmatic = 0;
  let settle: number | undefined;
  let guard: number | undefined;

  function itemWidth(): number {
    const first = track.firstElementChild as HTMLElement | null;
    return first?.offsetWidth ?? 60;
  }

  /** Half a track short of an item, so the first and last can reach the centre. */
  function applyPadding(): void {
    const pad = Math.max(0, (track.clientWidth - itemWidth()) / 2);
    track.style.paddingInline = `${pad}px`;
  }

  function markCurrent(): void {
    for (let i = 0; i < track.children.length; i += 1) {
      const child = track.children[i] as HTMLElement;
      child.setAttribute('aria-current', String(i === index));
    }
    track.setAttribute('aria-valuenow', String(index));
    track.setAttribute('aria-valuetext', scale[index]?.label ?? '');
  }

  /**
   * Move the strip ourselves. Our own scrolling must not be reported back as a
   * change, or the render that moved the dial would be told the dial moved and
   * render again forever, so each programmatic scroll leaves a token that the
   * settle handler consumes. The timer is only a backstop for the case where
   * the scroll lands somewhere that fires no further events.
   */
  function scrollToIndex(target: number, animate: boolean): void {
    const left = target * itemWidth();
    if (Math.abs(track.scrollLeft - left) < 1) return;
    programmatic += 1;
    window.clearTimeout(guard);
    guard = window.setTimeout(() => {
      programmatic = 0;
    }, animate ? 700 : 300);
    track.scrollTo({ left, behavior: animate ? 'smooth' : 'auto' });
  }

  track.addEventListener('scroll', () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      const next = Math.max(
        0,
        Math.min(scale.length - 1, Math.round(track.scrollLeft / itemWidth())),
      );
      const ours = programmatic > 0;
      if (ours) programmatic -= 1;
      if (next === index) return;
      index = next;
      markCurrent();
      if (!ours) onChange(index);
    }, 80);
  });

  track.addEventListener('keydown', (event) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'PageUp' ? 3 : event.key === 'PageDown' ? -3 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(scale.length - 1, index + delta));
    if (next === index) return;
    index = next;
    markCurrent();
    scrollToIndex(index, true);
    onChange(index);
  });

  window.addEventListener('resize', () => {
    applyPadding();
    scrollToIndex(index, false);
  });

  return {
    get index() {
      return index;
    },
    setScale(next, value) {
      const same =
        next.length === scale.length && next.every((v, i) => v.value === scale[i]?.value);
      if (!same) {
        scale = next;
        track.replaceChildren(
          ...next.map((entry) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'dial__item';
            item.dataset['full'] = String(isFullStop(entry.value, kind));
            item.textContent = entry.label;
            item.addEventListener('click', () => {
              const i = next.indexOf(entry);
              index = i;
              markCurrent();
              scrollToIndex(i, true);
              onChange(i);
            });
            return item;
          }),
        );
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', String(Math.max(0, next.length - 1)));
        applyPadding();
      }
      this.select(indexOfNearest(next, value), false);
    },
    select(target, animate = true) {
      const clamped = Math.max(0, Math.min(scale.length - 1, target));
      if (clamped === index && !animate) {
        markCurrent();
        return;
      }
      index = clamped;
      markCurrent();
      scrollToIndex(clamped, animate);
    },
  };
}


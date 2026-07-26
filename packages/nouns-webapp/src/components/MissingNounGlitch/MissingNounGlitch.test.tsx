/**
 * These cover the two ways this component could become a real bug rather than
 * an effect: leaving the page permanently corrupted, and reloading when the
 * user is mid-bid.
 */
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MissingNounGlitch from './index';

const PROSE = 'Winning bid held by someone';

const BID_LABEL = 'Place bid';
/** Every property the fault engine can set (see FAULTS). */
const FAULT_PROPS = ['display', 'position', 'left', 'width', 'direction', 'overflow', 'max-height'];

function mountPage() {
  const root = document.createElement('div');
  root.id = 'root';
  root.innerHTML =
    `<div><h1>${PROSE}</h1><p>${PROSE}</p><span>${PROSE}</span>` +
    `<div data-mn-safe><span>${BID_LABEL}</span><button>${BID_LABEL}</button></div></div>`;
  document.body.appendChild(root);
  return root;
}

const safeArea = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-mn-safe]')!;

const textOf = (root: HTMLElement) =>
  [...root.querySelectorAll('h1, p, span:not([data-mn-safe] span)')]
    .map(el => el.textContent)
    .join('|');

const reloadSpy = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  reloadSpy.mockClear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  // jsdom's location.reload isn't spyable in place.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  // The reload path requires a focused, visible tab.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('MissingNounGlitch damage', () => {
  it('does nothing at all when inactive', () => {
    const root = mountPage();
    render(<MissingNounGlitch active={false} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(textOf(root)).toBe([PROSE, PROSE, PROSE].join('|'));
    expect(document.body.className).toBe('');
  });

  it('corrupts text, recovers it, and never accumulates damage', () => {
    const root = mountPage();
    const pristine = [PROSE, PROSE, PROSE].join('|');
    render(<MissingNounGlitch active />);
    act(() => void vi.advanceTimersByTime(14_000)); // escalate past stage 0

    // Sampling for a settled state is flaky by nature — a burst may have just
    // fired. Assert the invariant instead: damage appears, damage recovers,
    // and corrupted text never grows (corrupt() is length-preserving, so drift
    // in length would mean restores are stacking).
    let sawCorruption = false;
    let sawRecovery = false;
    for (let i = 0; i < 120; i++) {
      act(() => void vi.advanceTimersByTime(100));
      const now = textOf(root);
      expect(now).toHaveLength(pristine.length);
      if (now !== pristine) sawCorruption = true;
      else if (sawCorruption) sawRecovery = true;
    }
    expect(sawCorruption).toBe(true);
    expect(sawRecovery).toBe(true);
  });

  it('repairs the page when unmounted mid-burst', () => {
    const root = mountPage();
    const view = render(<MissingNounGlitch active />);
    act(() => void vi.advanceTimersByTime(14_000));
    act(() => void vi.advanceTimersByTime(1_500));

    view.unmount();

    expect(textOf(root)).toBe([PROSE, PROSE, PROSE].join('|'));
    expect(document.body.className).toBe('');
  });

  it('never reloads while the user is typing — they may be mid-bid', () => {
    mountPage();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    // Force the coin-flip toward reloading, so only the guards can stop it.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    render(<MissingNounGlitch active />);
    act(() => void vi.advanceTimersByTime(120_000));

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads at most once per session, so /v2 cannot reload-loop', () => {
    mountPage();
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    render(<MissingNounGlitch active />);
    // Well past several peak-stage cycles.
    act(() => void vi.advanceTimersByTime(300_000));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('mn-glitch-reloaded')).toBe('1');
  });

  it('never damages the bid controls — they are the only way out', () => {
    const root = mountPage();
    render(<MissingNounGlitch active />);

    // Run well past peak stage, sampling continuously rather than at the end:
    // a single hidden frame on the bid button is enough to strand the user.
    for (let i = 0; i < 600; i++) {
      act(() => void vi.advanceTimersByTime(100));
      const safe = safeArea(root);
      expect(safe.textContent).toBe(`${BID_LABEL}${BID_LABEL}`);
      expect(safe.getAttribute('style')).toBeNull();
      // An ancestor going display:none would hide the bid form just as surely.
      // Only layout properties count — body legitimately carries the --mn-*
      // custom properties that drive the CSS texture.
      for (let el = safe.parentElement; el; el = el.parentElement) {
        FAULT_PROPS.forEach(prop => expect(el!.style.getPropertyValue(prop)).toBe(''));
      }
    }
  });

  it('leaves no inline styles behind after teardown', () => {
    const root = mountPage();
    const view = render(<MissingNounGlitch active />);
    act(() => void vi.advanceTimersByTime(40_000));
    view.unmount();
    const withStyle = [...root.querySelectorAll<HTMLElement>('*')].filter(el =>
      el.getAttribute('style'),
    );
    expect(withStyle).toEqual([]);
  });
});

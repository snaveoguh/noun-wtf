import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTAINER_BREAKPOINTS, tierFor } from '@/lib/responsive/breakpoints';

import { findContainer, useContainerWidth } from './useContainerWidth';

type ROCallback = (entries: { contentBoxSize?: { inlineSize: number }[] }[]) => void;

let observers: { cb: ROCallback; targets: Element[]; disconnected: boolean }[] = [];

class FakeResizeObserver {
  rec: { cb: ROCallback; targets: Element[]; disconnected: boolean };
  constructor(cb: ROCallback) {
    this.rec = { cb, targets: [], disconnected: false };
    observers.push(this.rec);
  }
  observe(el: Element) {
    this.rec.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.rec.disconnected = true;
  }
}

function Probe({ self = false }: { self?: boolean }) {
  const { ref, width, tier, atLeast, below } = useContainerWidth<HTMLDivElement>({ self });
  return (
    <div ref={ref} data-testid="probe">
      {width}|{tier}|{atLeast('md') ? 'md+' : 'narrow'}|{below('sm') ? 'xs' : 'not-xs'}
    </div>
  );
}

function setClientWidth(el: HTMLElement, w: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: w });
}

describe('tierFor', () => {
  it('maps each band edge to its tier', () => {
    expect(tierFor(0)).toBe('xs');
    expect(tierFor(320)).toBe('xs');
    expect(tierFor(399)).toBe('xs');
    expect(tierFor(400)).toBe('sm');
    expect(tierFor(559)).toBe('sm');
    expect(tierFor(560)).toBe('md');
    expect(tierFor(620)).toBe('md');
    expect(tierFor(759)).toBe('md');
    expect(tierFor(760)).toBe('lg');
    expect(tierFor(1023)).toBe('lg');
    expect(tierFor(1024)).toBe('xl');
    expect(tierFor(1440)).toBe('2xl');
    expect(tierFor(2560)).toBe('2xl');
  });

  it('keeps the tokens ascending', () => {
    const v = Object.values(CONTAINER_BREAKPOINTS);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
  });
});

describe('useContainerWidth', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('measures the nearest [data-container] and follows it as it resizes', () => {
    // A 620 px window on a 1440 px screen: the page must see 620, not 1440.
    vi.stubGlobal('innerWidth', 1440);
    const host = document.createElement('div');
    host.setAttribute('data-container', 'page');
    setClientWidth(host, 620);
    document.body.appendChild(host);

    render(<Probe />, { container: host });
    expect(screen.getByTestId('probe').textContent).toBe('620|md|md+|not-xs');

    const ro = observers.find(o => o.targets.includes(host));
    expect(ro).toBeDefined();
    act(() => ro!.cb([{ contentBoxSize: [{ inlineSize: 360 }] }]));
    expect(screen.getByTestId('probe').textContent).toBe('360|xs|narrow|xs');

    act(() => ro!.cb([{ contentBoxSize: [{ inlineSize: 1100.4 }] }]));
    expect(screen.getByTestId('probe').textContent).toBe('1100|xl|md+|not-xs');
    host.remove();
  });

  it('falls back to the viewport outside any container (unchanged behaviour)', () => {
    vi.stubGlobal('innerWidth', 390);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('390|xs|narrow|xs');
    act(() => {
      vi.stubGlobal('innerWidth', 900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('probe').textContent).toBe('900|lg|md+|not-xs');
  });

  it('measures the element itself with { self: true }', () => {
    vi.stubGlobal('innerWidth', 1440);
    const host = document.createElement('div');
    host.setAttribute('data-container', 'page');
    setClientWidth(host, 1200);
    document.body.appendChild(host);
    const { getByTestId } = render(<Probe self />, { container: host });
    const ro = observers.find(o => o.targets.includes(getByTestId('probe')));
    expect(ro).toBeDefined();
    act(() => ro!.cb([{ contentBoxSize: [{ inlineSize: 450 }] }]));
    expect(getByTestId('probe').textContent).toBe('450|sm|narrow|not-xs');
    host.remove();
  });

  it('disconnects on unmount', () => {
    const host = document.createElement('div');
    host.setAttribute('data-container', 'page');
    document.body.appendChild(host);
    const { unmount } = render(<Probe />, { container: host });
    const ro = observers.find(o => o.targets.includes(host))!;
    unmount();
    expect(ro.disconnected).toBe(true);
    host.remove();
  });
});

describe('findContainer', () => {
  it('finds the closest container, nested ones first', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-container', 'page');
    const inner = document.createElement('section');
    inner.setAttribute('data-container', 'card');
    const leaf = document.createElement('span');
    inner.appendChild(leaf);
    outer.appendChild(inner);
    expect(findContainer(leaf)).toBe(inner);
    expect(findContainer(inner)).toBe(inner);
    expect(findContainer(document.createElement('p'))).toBeNull();
  });
});

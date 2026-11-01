import { describe, expect, it } from 'vitest';

import { safeAreaVars, maybeMiniApp } from './miniApp';
import {
  linkRoute,
  shareName,
  shareOrigin,
  shareText,
  snapshotFileName,
  snapshotRoute,
  stripHeight,
} from './share';

describe('in-game share', () => {
  it('casts in a mini app, uses the share sheet on touch, copies on desktop', () => {
    expect(linkRoute({ miniApp: true, canShare: true, touch: true })).toBe('cast');
    expect(linkRoute({ miniApp: false, canShare: true, touch: true })).toBe('sheet');
    expect(linkRoute({ miniApp: false, canShare: true, touch: false })).toBe('copy');
    expect(linkRoute({ miniApp: false, canShare: false, touch: true })).toBe('copy');
    expect(snapshotRoute({ canShareFiles: true, touch: true })).toBe('sheet');
    expect(snapshotRoute({ canShareFiles: true, touch: false })).toBe('download');
    expect(snapshotRoute({ canShareFiles: false, touch: true })).toBe('download');
  });

  it('leaves the default rider name out of links', () => {
    expect(shareName('noun 120')).toBe('');
    expect(shareName('lil67')).toBe('lil67');
    expect(shareText('noun 3')).toMatch(/^Play as me/);
    expect(shareText('zed')).toMatch(/^Play as zed/);
  });

  it('points links at the site you are on, but never at localhost', () => {
    expect(shareOrigin({ hostname: 'noun.wtf', origin: 'https://noun.wtf' })).toBe(
      'https://noun.wtf',
    );
    expect(
      shareOrigin({
        hostname: 'dev-noun-wtf.netlify.app',
        origin: 'https://dev-noun-wtf.netlify.app',
      }),
    ).toBe('https://dev-noun-wtf.netlify.app');
    expect(shareOrigin({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:5196' })).toBeUndefined();
  });

  it('names and sizes snapshots', () => {
    expect(snapshotFileName(new Date(2026, 10, 1, 9, 5))).toBe('noun-world-2026-11-01-0905.png');
    expect(stripHeight(1080)).toBe(65);
    expect(stripHeight(200)).toBe(28);
  });

  it('turns the host safe areas into the HUD’s CSS variables', () => {
    expect(safeAreaVars({ top: 47.4, bottom: 34, left: 0, right: -3 })).toEqual({
      '--w2-safe-top': '47px',
      '--w2-safe-right': '0px',
      '--w2-safe-bottom': '34px',
      '--w2-safe-left': '0px',
    });
    expect(safeAreaVars(undefined)['--w2-safe-top']).toBe('0px');
  });

  it('only suspects a mini app inside a frame or a native webview', () => {
    const top: { parent?: unknown } = {};
    top.parent = top;
    expect(maybeMiniApp(top)).toBe(false);
    expect(maybeMiniApp({ parent: {} })).toBe(true);
    const rn: { parent?: unknown; ReactNativeWebView?: unknown } = { ReactNativeWebView: {} };
    rn.parent = rn;
    expect(maybeMiniApp(rn)).toBe(true);
  });
});

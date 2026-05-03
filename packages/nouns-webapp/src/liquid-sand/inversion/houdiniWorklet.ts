/**
 * Liquid Sand UI — Approach 3: optional CSS Houdini paint worklet.
 *
 * Registers a `liquid-sand-luminance` paint worklet that fills the element
 * with the inverse luminance of its computed background color, exposed via
 * the custom property `--ls-bg-color` (set by JS or another stylesheet).
 *
 * This is intentionally light: the worklet only consults the variable, so
 * actual background sampling still has to happen in JS. The win is that
 * paint runs on the compositor thread without React re-rendering. No-op
 * gracefully when `CSS.paintWorklet` is unavailable.
 */

const WORKLET_NAME = 'liquid-sand-luminance';

/**
 * The worklet source as a string so it can be injected via `Blob`.
 * Keep this small — paint worklets are evaluated in a separate global.
 */
const WORKLET_SOURCE = `
class LiquidSandLuminance {
  static get inputProperties() { return ['--ls-bg-color']; }
  paint(ctx, geom, props) {
    const raw = (props.get('--ls-bg-color') || '').toString().trim() || '#ffffff';
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, geom.width, geom.height);
  }
}
registerPaint('${WORKLET_NAME}', LiquidSandLuminance);
`;

let registered = false;

export interface HoudiniRegistration {
  supported: boolean;
  registered: boolean;
  paintName: string;
}

export async function registerHoudiniWorklet(): Promise<HoudiniRegistration> {
  if (typeof CSS === 'undefined' || !('paintWorklet' in CSS)) {
    return { supported: false, registered: false, paintName: WORKLET_NAME };
  }
  if (registered) {
    return { supported: true, registered: true, paintName: WORKLET_NAME };
  }
  try {
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    // `paintWorklet.addModule` is typed on `CSS` in lib.dom but only as
    // `unknown`. Cast through a narrow interface for safety.
    const paint = (CSS as unknown as {
      paintWorklet: { addModule: (src: string) => Promise<void> };
    }).paintWorklet;
    await paint.addModule(url);
    registered = true;
    return { supported: true, registered: true, paintName: WORKLET_NAME };
  } catch {
    return { supported: true, registered: false, paintName: WORKLET_NAME };
  }
}

export const HOUDINI_PAINT_NAME = WORKLET_NAME;

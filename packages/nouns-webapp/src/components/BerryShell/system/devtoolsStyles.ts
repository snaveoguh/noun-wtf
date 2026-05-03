/**
 * Shared styles for Activity Monitor + Console + Event Inspector.
 *
 * Pulled out so a future palette swap (System 7 vs Aqua vs Big Sur) can land
 * in one file. Everything here is tabular-numeric, dense, and intentionally
 * cool-grey — Activity Monitor on real macOS uses a near-monochrome chrome
 * so the data does the talking.
 */

import type { CSSProperties } from 'react';

export const MONO_FONT =
  '"SF Mono", "Monaco", "Menlo", "Consolas", "Liberation Mono", monospace';

/** Color category for a bus event name — used for table row tints + chips. */
export type EventCategory =
  | 'window'
  | 'app'
  | 'system'
  | 'notification'
  | 'auction'
  | 'service'
  | 'permission'
  | 'hotkey'
  | 'other';

export function categoryFor(name: string): EventCategory {
  const prefix = name.split(':')[0] ?? '';
  switch (prefix) {
    case 'window':
      return 'window';
    case 'app':
      return 'app';
    case 'system':
      return 'system';
    case 'notification':
      return 'notification';
    case 'auction':
      return 'auction';
    case 'service':
      return 'service';
    case 'permission':
      return 'permission';
    case 'hotkey':
      return 'hotkey';
    default:
      return 'other';
  }
}

/**
 * Color-coding choices: each category gets a Big-Sur-ish soft bg + dot.
 * - window: blue (movement / lifecycle of UI)
 * - app: green (process lifecycle)
 * - system: purple (boot / theme / wallet)
 * - notification: yellow (user-visible)
 * - auction: pink (domain-level: ours)
 * - service: teal (background)
 * - permission: orange (security)
 * - hotkey: indigo (input)
 * - other: grey
 */
export const CATEGORY_COLOR: Record<EventCategory, { bg: string; fg: string; dot: string }> = {
  window: { bg: 'rgba(0, 122, 255, 0.10)', fg: '#0040a8', dot: '#007aff' },
  app: { bg: 'rgba(40, 205, 65, 0.10)', fg: '#1f7a31', dot: '#28cd41' },
  system: { bg: 'rgba(175, 82, 222, 0.10)', fg: '#6a1f9a', dot: '#af52de' },
  notification: { bg: 'rgba(255, 204, 0, 0.16)', fg: '#7a5800', dot: '#ffcc00' },
  auction: { bg: 'rgba(255, 45, 85, 0.10)', fg: '#a31040', dot: '#ff2d55' },
  service: { bg: 'rgba(0, 199, 190, 0.10)', fg: '#107a72', dot: '#00c7be' },
  permission: { bg: 'rgba(255, 149, 0, 0.10)', fg: '#9a4f00', dot: '#ff9500' },
  hotkey: { bg: 'rgba(88, 86, 214, 0.10)', fg: '#3c3a8c', dot: '#5856d6' },
  other: { bg: 'rgba(142, 142, 147, 0.12)', fg: '#3a3a3c', dot: '#8e8e93' },
};

export const tabBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  background:
    'linear-gradient(180deg, #f6f6f6 0%, #ebebeb 50%, #dedede 100%)',
  borderBottom: '1px solid #b9b9b9',
  padding: '4px 6px 0 6px',
  gap: 1,
  fontFamily: 'var(--theme-font-display)',
  fontSize: 12,
};

export function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    border: '1px solid #aeaeae',
    borderBottom: active ? '1px solid transparent' : '1px solid #aeaeae',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    padding: '4px 12px',
    marginBottom: -1,
    background: active
      ? 'linear-gradient(180deg, #fcfcfc 0%, #ececec 100%)'
      : 'linear-gradient(180deg, #ececec 0%, #d2d2d2 100%)',
    color: active ? '#1d1d1f' : '#3c3c43',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 12,
    letterSpacing: 0.1,
  };
}

export const tableShellStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#ffffff',
};

export const tableHeaderRowStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'grid',
  background:
    'linear-gradient(180deg, #f0f0f0 0%, #e3e3e3 100%)',
  borderBottom: '1px solid #c4c4c4',
  fontSize: 11,
  fontWeight: 600,
  color: '#3c3c43',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  userSelect: 'none',
};

export const tableHeaderCellStyle: CSSProperties = {
  padding: '5px 8px',
  borderRight: '1px solid #d4d4d4',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const tableBodyStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  fontFamily: MONO_FONT,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
};

export function tableRowStyle(zebra: boolean, highlight?: string): CSSProperties {
  return {
    display: 'grid',
    background: highlight ?? (zebra ? '#fafbfc' : '#ffffff'),
    borderBottom: '1px solid #efefef',
    color: '#1d1d1f',
  };
}

export const tableCellStyle: CSSProperties = {
  padding: '4px 8px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontVariantNumeric: 'tabular-nums',
};

export const subtleButtonStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid #b8b8b8',
  borderRadius: 4,
  background:
    'linear-gradient(180deg, #ffffff 0%, #ececec 100%)',
  color: '#1d1d1f',
  padding: '2px 8px',
  fontSize: 11,
  fontFamily: 'var(--theme-font-display)',
  cursor: 'pointer',
  boxShadow: '0 1px 0 rgba(0,0,0,0.05)',
};

export const dangerButtonStyle: CSSProperties = {
  ...subtleButtonStyle,
  border: '1px solid #c14848',
  background:
    'linear-gradient(180deg, #ff8b8b 0%, #e25151 100%)',
  color: '#fff',
  textShadow: '0 1px 0 rgba(0,0,0,0.25)',
};

export const inputStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid #c0c0c0',
  borderRadius: 4,
  background: '#fff',
  color: '#1d1d1f',
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: MONO_FONT,
  flex: 1,
  minWidth: 0,
  outline: 'none',
};

export const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  background:
    'linear-gradient(180deg, #f4f4f4 0%, #e6e6e6 100%)',
  borderBottom: '1px solid #c4c4c4',
};

export const chipStyle = (cat: EventCategory): CSSProperties => {
  const c = CATEGORY_COLOR[cat];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.dot}33`,
    borderRadius: 9,
    padding: '0 6px',
    height: 16,
    fontSize: 10,
    fontWeight: 600,
    fontFamily: MONO_FONT,
    letterSpacing: 0.2,
  };
};

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, '0')}m`;
}

export function compactJson(payload: unknown, max = 120): string {
  if (payload == null) return '∅';
  let s: string;
  try {
    s = JSON.stringify(payload);
  } catch {
    s = String(payload);
  }
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

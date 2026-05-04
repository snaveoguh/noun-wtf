/**
 * BerryOS hotkey registry — global keydown listener + scoped dispatch.
 *
 * Designed to coexist with browser-native shortcuts: we *only* preventDefault
 * when a registered hotkey actually matches AND its `preventDefault` is true
 * (default true). Untyped keypresses fall through to the page.
 *
 * Scope rules:
 *   - 'global'        — fires whenever the document has focus (input guard
 *                        applies — see below).
 *   - any other id    — interpreted as an `appId`; only fires when the
 *                        currently focused app (per `app:focused` events) is
 *                        that id.
 *
 * Input guard:
 *   When the user is typing in an `<input>`, `<textarea>`, or
 *   `[contenteditable]`, hotkeys WITHOUT a meta/ctrl modifier are suppressed
 *   so we don't steal letter-keys from forms. Combos with meta/ctrl always
 *   fire (matches Mac convention — cmd+W still closes a window even mid-form).
 *
 * Combo grammar:
 *   `<modifier>+<modifier>+...+<key>` — case-insensitive, modifiers in any
 *   order. `meta` and `cmd` are aliases. Recognised modifiers: meta, cmd,
 *   ctrl, alt, opt, shift. Key is the final token (e.g. `'a'`, `'space'`,
 *   `'esc'`, `','`, `'/'`, `'arrowup'`).
 */

import { useEffect, useRef } from 'react';

import { berryBus } from './eventBus';
// Side-effect import — augments BerryEventMap with hotkey:* + spotlight:* events.
import './spotlightEvents';

export type BerryHotkeyScope = 'global' | string;

export interface BerryHotkey {
  id: string;
  combo: string;
  description: string;
  scope: BerryHotkeyScope;
  handler: (e: KeyboardEvent) => void;
  /** Default true — suppresses the browser default when the combo matches. */
  preventDefault?: boolean;
}

interface ParsedCombo {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-case canonical key, see KEY_ALIASES. */
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  ' ': 'space',
  spacebar: 'space',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  minus: '-',
};

function canonicalKey(raw: string): string {
  const lower = raw.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
  const out: ParsedCombo = { meta: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'meta' || lower === 'cmd' || lower === 'command') out.meta = true;
    else if (lower === 'ctrl' || lower === 'control') out.ctrl = true;
    else if (lower === 'alt' || lower === 'opt' || lower === 'option') out.alt = true;
    else if (lower === 'shift') out.shift = true;
    else out.key = canonicalKey(part);
  }
  return out;
}

function eventMatches(e: KeyboardEvent, p: ParsedCombo): boolean {
  if (p.meta !== e.metaKey) return false;
  if (p.ctrl !== e.ctrlKey) return false;
  if (p.alt !== e.altKey) return false;
  // Shift is intentionally allowed to "punch through" for symbol keys (e.g.
  // `,` always fires regardless of shift state) UNLESS the combo explicitly
  // requires shift, in which case it must be held.
  if (p.shift && !e.shiftKey) return false;

  const key = canonicalKey(e.key);
  if (key === p.key) return true;

  // Fallback: KeyboardEvent.code maps physical key positions, useful for
  // alphanumerics where shifted layouts mangle e.key.
  const codeKey = e.code.toLowerCase().replace(/^key|^digit/, '');
  if (codeKey === p.key) return true;

  return false;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

class BerryHotkeyManager {
  private readonly registry = new Map<string, BerryHotkey>();
  private focusedAppId: string | null = null;
  private listenerAttached = false;
  private offAppFocused?: () => void;

  register(hotkey: BerryHotkey): () => void {
    if (this.registry.has(hotkey.id)) {
      // Re-registering with the same id replaces; common during HMR + React
      // strict-mode double-mounts.
      this.registry.set(hotkey.id, hotkey);
    } else {
      this.registry.set(hotkey.id, hotkey);
    }
    this.ensureListener();
    return () => this.unregister(hotkey.id);
  }

  unregister(id: string): void {
    this.registry.delete(id);
  }

  list(): BerryHotkey[] {
    return Array.from(this.registry.values());
  }

  /** Test helper — clears all hotkeys and detaches the listener. */
  reset(): void {
    this.registry.clear();
    if (this.offAppFocused) this.offAppFocused();
    this.offAppFocused = undefined;
    if (this.listenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
    }
    this.listenerAttached = false;
    this.focusedAppId = null;
  }

  private ensureListener(): void {
    if (this.listenerAttached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown, true);
    this.listenerAttached = true;

    // Track focused app for scope filtering. We don't import windowStore so
    // this stays decoupled — bus events are the contract.
    this.offAppFocused = berryBus.on('app:focused', payload => {
      this.focusedAppId = payload.appId;
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const typing = isTypingTarget(e.target);

    // Iterate in registration order; first match wins.
    for (const hotkey of this.registry.values()) {
      const parsed = parseCombo(hotkey.combo);

      // Input guard: suppress non-modifier hotkeys while typing.
      if (typing && !parsed.meta && !parsed.ctrl) continue;

      // Scope check.
      if (hotkey.scope !== 'global' && hotkey.scope !== this.focusedAppId) continue;

      if (!eventMatches(e, parsed)) continue;

      const prevent = hotkey.preventDefault !== false;
      if (prevent) {
        e.preventDefault();
        e.stopPropagation();
      }

      try {
        hotkey.handler(e);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[berry-hotkey] handler "${hotkey.id}" threw`, err);
      }

      berryBus.emit('hotkey:fired', { id: hotkey.id, combo: hotkey.combo, scope: hotkey.scope });
      return;
    }
  };
}

export const hotkeyManager = new BerryHotkeyManager();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Register a hotkey for the lifetime of a component. The id is derived from
 * the combo + a useRef-stable suffix so multiple components can share a combo
 * (the manager replaces by id, so the suffix matters).
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  deps: ReadonlyArray<unknown> = [],
  options: { description?: string; scope?: BerryHotkeyScope; preventDefault?: boolean } = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = `hotkey-${combo}-${Math.random().toString(36).slice(2, 8)}`;
  }

  useEffect(() => {
    const off = hotkeyManager.register({
      id: idRef.current,
      combo,
      description: options.description ?? combo,
      scope: options.scope ?? 'global',
      preventDefault: options.preventDefault,
      handler: e => handlerRef.current(e),
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, options.scope, options.description, options.preventDefault, ...deps]);
}

// Re-export combo parser for tests / debug tooling.
export const __test = { parseCombo, eventMatches, canonicalKey };

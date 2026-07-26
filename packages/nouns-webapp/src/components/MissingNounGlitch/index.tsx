/**
 * MissingNounGlitch — when the V2 `missingnoun` head is on screen, the page
 * stops holding itself together.
 *
 * CSS filters read as decoration, so the damage here is real: text nodes are
 * genuinely corrupted and elements genuinely reflow. Two rules keep that from
 * becoming an actual bug:
 *
 *   1. Nodes are never added or removed — only `nodeValue` and `style` are
 *      touched. Removing a node React owns throws NotFoundError on its next
 *      reconcile.
 *   2. Every restore checks the value is still the one we wrote. If React
 *      re-rendered mid-burst it has already written the correct text, and
 *      blindly restoring our snapshot would put stale text back on screen.
 *
 * Faults escalate over ~40s, then either reload the page or subside and build
 * again. The reload is one-shot per session (see canReload) — missingnoun is
 * the *current* auction noun, on screen for a full day, so a repeatable reload
 * is an infinite loop that bricks /v2 for the whole auction.
 */
import { FC, useEffect, useMemo, useRef, useState } from 'react';

import classes from './MissingNounGlitch.module.css';

interface Props {
  active: boolean;
}

const RELOAD_ONCE_KEY = 'mn-glitch-reloaded';
/** A user mid-bid is clicking or typing; an idle one isn't. */
const IDLE_BEFORE_RELOAD_MS = 8_000;
const ESCALATE_EVERY_MS = 13_000;
/** Stage 4 is meant to be genuinely unusable — everything that matters is
 *  fenced off behind data-mn-safe, and a refresh clears it. */
const MAX_STAGE = 4;
/** At peak, reload rather than subside this often. */
const RELOAD_CHANCE = 0.5;

const GLYPHS = [...'█▓▒░◼╳¿◊#@%&※¤◙╬�'];

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)];

/** Corrupt in place — same length, so the corruption reads as data damage
 *  rather than as a layout change. */
function corrupt(text: string, severity: number): string {
  return [...text]
    .map(ch => {
      if (ch === ' ' || Math.random() > severity) return ch;
      // Mixing glyph substitution with codepoint drift matters: pure glyphs
      // look like a redaction, pure drift looks like an encoding bug. Together
      // they look like memory going bad.
      return Math.random() < 0.6
        ? pick(GLYPHS)
        : String.fromCharCode(ch.charCodeAt(0) + Math.round(rand(-2, 2)));
    })
    .join('');
}

/** Subtrees the glitch must leave alone — see the `data-mn-safe` note in Bid. */
const SAFE_SELECTOR = '[data-mn-safe]';

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (/^(script|style|noscript)$/i.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SAFE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if ((node.nodeValue?.trim().length ?? 0) < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out: Text[] = [];
  // Capped: a full walk of a busy page every burst is a lot of main-thread
  // work for nodes we'd only sample from anyway.
  while (out.length < 400) {
    const next = walker.nextNode();
    if (!next) break;
    out.push(next as Text);
  }
  return out;
}

/** Real layout faults — these reflow the page, unlike a transform. */
const FAULTS: Array<(s: CSSStyleDeclaration) => string[]> = [
  s => {
    s.setProperty('display', 'none');
    return ['display'];
  },
  s => {
    s.setProperty('position', 'relative');
    s.setProperty('left', `${Math.round(rand(-24, 24))}px`);
    return ['position', 'left'];
  },
  s => {
    s.setProperty('width', `${Math.round(rand(30, 70))}%`);
    return ['width'];
  },
  s => {
    s.setProperty('direction', 'rtl');
    return ['direction'];
  },
  s => {
    s.setProperty('overflow', 'hidden');
    s.setProperty('max-height', `${Math.round(rand(8, 40))}px`);
    return ['overflow', 'max-height'];
  },
];

function faultCandidates(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('div, section, header, p, h1, h2, h3, li')].filter(
    el => !el.closest(SAFE_SELECTOR) && !el.querySelector(SAFE_SELECTOR),
  );
}

/**
 * A reload is only safe when the user plainly isn't doing anything: no wallet
 * popup (the page loses focus), no typing, tab in front, and idle. Reloading
 * under a pending bid would orphan the wallet confirm.
 */
function canReload(lastInteractionAt: number): boolean {
  if (sessionStorage.getItem(RELOAD_ONCE_KEY)) return false;
  if (document.hidden || !document.hasFocus()) return false;
  if (Date.now() - lastInteractionAt < IDLE_BEFORE_RELOAD_MS) return false;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return false;
  return true;
}

const MissingNounGlitch: FC<Props> = ({ active }) => {
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const enabled = active && !prefersReducedMotion;

  const [stage, setStage] = useState(0);
  const lastInteractionAt = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;
    const touch = () => (lastInteractionAt.current = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, touch));
  }, [enabled]);

  // Escalate, then either reload or subside and start over — a fault that only
  // ever climbs reads as a stuck animation.
  useEffect(() => {
    if (!enabled) {
      setStage(0);
      return;
    }
    const timer = setInterval(() => {
      setStage(prev => {
        if (prev < MAX_STAGE) return prev + 1;
        if (Math.random() < RELOAD_CHANCE && canReload(lastInteractionAt.current)) {
          sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
          window.location.reload();
        }
        return 0;
      });
    }, ESCALATE_EVERY_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // The fault engine.
  useEffect(() => {
    if (!enabled || stage === 0) return;
    const root = document.getElementById('root');
    if (!root) return;

    let burstTimer: ReturnType<typeof setTimeout>;
    let restoreTimer: ReturnType<typeof setTimeout>;
    // Held so teardown can repair synchronously. This effect is torn down on
    // every stage change, and a burst interrupted between damage and restore
    // would otherwise leave the corruption on screen permanently.
    let pendingRestore: (() => void) | null = null;

    const runBurst = () => {
      const textNodes = collectTextNodes(root);
      const severity = 0.1 * stage;
      const damaged: Array<{ node: Text; original: string; written: string }> = [];

      // Each node is damaged at most once per burst. Hitting one twice would
      // snapshot the first burst's corruption as the second's "original", and
      // the restore would then faithfully put the corruption back — for good.
      const seenNodes = new Set<Text>();
      for (let i = 0; i < stage * 6 && textNodes.length; i++) {
        const node = pick(textNodes);
        if (seenNodes.has(node)) continue;
        seenNodes.add(node);
        const original = node.nodeValue ?? '';
        const written = corrupt(original, severity);
        if (written === original) continue;
        node.nodeValue = written;
        damaged.push({ node, original, written });
      }

      const broken: Array<{ el: HTMLElement; cssProps: string[] }> = [];
      if (stage >= 2) {
        const candidates = faultCandidates(root);
        const seenEls = new Set<HTMLElement>();
        for (let i = 0; i < (stage - 1) * 2 && candidates.length; i++) {
          const el = pick(candidates);
          if (seenEls.has(el)) continue;
          seenEls.add(el);
          broken.push({ el, cssProps: pick(FAULTS)(el.style) });
        }
      }

      // Font swaps are a burst, not a state: a page stuck in the wrong
      // typeface just looks like a broken stylesheet, but a page that drops
      // into fallback for 100ms looks like the font failed to load.
      const swappedFont = stage >= 2 && Math.random() < 0.4;
      if (swappedFont) document.body.classList.add(classes.fontSwapOn);

      const restore = () => {
        pendingRestore = null;
        // Only undo what's still ours — see the file header.
        damaged.forEach(({ node, original, written }) => {
          if (node.nodeValue === written) node.nodeValue = original;
        });
        broken.forEach(({ el, cssProps }) => cssProps.forEach(p => el.style.removeProperty(p)));
        if (swappedFont) document.body.classList.remove(classes.fontSwapOn);
      };
      pendingRestore = restore;
      restoreTimer = setTimeout(restore, rand(70, 90 + stage * 60));

      burstTimer = setTimeout(runBurst, rand(1_800 - stage * 350, 4_200 - stage * 800));
    };

    burstTimer = setTimeout(runBurst, rand(400, 1_400));
    return () => {
      clearTimeout(burstTimer);
      clearTimeout(restoreTimer);
      pendingRestore?.();
      document.body.classList.remove(classes.fontSwapOn);
    };
  }, [enabled, stage]);

  // A CSS texture underneath the faults, tightening as the stage climbs.
  useEffect(() => {
    if (!enabled || stage === 0) return;
    const { body } = document;
    const applied = [classes.glitching, classes.chroma];
    if (stage >= 2) applied.push(classes.typeJitter);
    if (stage >= 3) applied.push(pick([classes.slice, classes.flicker]));
    body.classList.add(...applied);
    body.style.setProperty('--mn-split', `${(stage * 1.1).toFixed(2)}px`);
    body.style.setProperty('--mn-speed', `${(3.4 - stage * 0.6).toFixed(2)}s`);
    body.style.setProperty('--mn-skew', `${(stage * 0.35).toFixed(2)}deg`);
    body.style.setProperty('--mn-hue', `${Math.round(rand(60, 300))}deg`);

    return () => {
      body.classList.remove(...applied);
      ['--mn-split', '--mn-speed', '--mn-skew', '--mn-hue'].forEach(p =>
        body.style.removeProperty(p),
      );
    };
  }, [enabled, stage]);

  if (!enabled || stage === 0) return null;

  return (
    <div
      aria-hidden="true"
      className={[classes.overlay, classes.scanlines, stage >= 2 ? classes.roll : '']
        .filter(Boolean)
        .join(' ')}
    />
  );
};

export default MissingNounGlitch;

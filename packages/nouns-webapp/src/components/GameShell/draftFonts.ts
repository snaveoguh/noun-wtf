/**
 * Draft-window font picker — a per-window override of the site font.
 *
 * The registry lives in src/lib/siteFonts.ts (shared with the header
 * FontSwitcher). This file only adds the draft window's own persistence:
 * a stored draft choice wins; otherwise the window follows the site font.
 */
import {
  ensureFontLoaded,
  getSiteFont,
  getSiteFontId,
  SITE_FONT_GROUPS,
  SITE_FONTS,
  type SiteFont,
  type SiteFontGroup,
} from '@/lib/siteFonts';

export type DraftFont = SiteFont;
export type DraftFontGroup = SiteFontGroup;
export const DRAFT_FONTS = SITE_FONTS;
export const DRAFT_FONT_GROUPS = SITE_FONT_GROUPS;

const STORAGE_KEY = 'nounwtf:draft-font';

export function getDraftFont(id: string | null | undefined): DraftFont {
  return getSiteFont(id);
}

/** Stored draft override, else the site font. */
export function loadDraftFontId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && SITE_FONTS.some(f => f.id === stored)) return stored;
  } catch {
    // fall through
  }
  return getSiteFontId();
}

export function saveDraftFontId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage — the choice just won't persist.
  }
}

export const ensureDraftFontLoaded = ensureFontLoaded;

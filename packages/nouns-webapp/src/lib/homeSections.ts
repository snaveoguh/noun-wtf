/**
 * homeSections — the configurable bits of the Dice (abacus) home page.
 *
 * The default home is just the noun + the auction. Everything else (wire
 * strip, banners, intro copy, hero tooling) is an opt-in "section" the visitor
 * switches on from the ⚙ customise popover. The enabled set + the hero layout
 * preference live in localStorage and can be seeded/overridden from the URL:
 *
 *   ?sections=all | none | onchainWire,dreams,...
 *   ?hero=classic | centered | split | poster
 *
 * Kept framework-free (plain module store) so the page, the hero and the app
 * chrome can all read the same state without prop-drilling; React binds via
 * `useHomeSections` (useSyncExternalStore).
 */

export type HomeSectionId =
  | 'onchainWire'
  | 'lilNouns'
  | 'fundedProps'
  | 'nocTicker'
  | 'propdates'
  | 'currentProps'
  | 'dreams'
  | 'noundry'
  | 'intro'
  | 'heroTools'
  | 'heroPrompt';

export interface HomeSection {
  id: HomeSectionId;
  label: string;
  description: string;
}

/** Page order is the order here — the page maps over enabled ids in this sequence. */
export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: 'heroTools', label: 'Hero tools', description: '3D / ASCII / edit tabs + save rail' },
  { id: 'heroPrompt', label: 'Noun chat', description: 'The poetic line + chat / jump bar' },
  { id: 'onchainWire', label: 'Onchain wire', description: 'Live activity strip above the noun' },
  { id: 'lilNouns', label: 'Lil Nouns', description: 'Mint row for the little ones' },
  { id: 'fundedProps', label: 'Funded props', description: 'Recently funded proposals' },
  { id: 'nocTicker', label: 'Noc ticker', description: 'The noun-o-clock ticker' },
  { id: 'propdates', label: 'Propdates', description: 'Latest proposal updates' },
  { id: 'currentProps', label: 'Current props', description: 'Proposals open for voting' },
  { id: 'dreams', label: 'Dreams', description: 'Community dream nouns' },
  { id: 'noundry', label: 'Noundry', description: 'Trait candidates from Noundry' },
  { id: 'intro', label: 'About Nouns', description: 'Intro + documentation' },
];

const SECTION_IDS: ReadonlySet<string> = new Set(HOME_SECTIONS.map(section => section.id));

export function isHomeSectionId(value: unknown): value is HomeSectionId {
  return typeof value === 'string' && SECTION_IDS.has(value);
}

export type HeroStyle = 'classic' | 'centered' | 'split' | 'poster';

export interface HeroStyleOption {
  id: HeroStyle;
  label: string;
  description: string;
}

export const HERO_STYLES: readonly HeroStyleOption[] = [
  { id: 'classic', label: 'Classic', description: 'Stage + sidebar cards' },
  { id: 'centered', label: 'Centred', description: 'Big noun, bids stacked beneath' },
  { id: 'split', label: 'Split', description: 'Noun left, sparse column right' },
  { id: 'poster', label: 'Poster', description: 'Full-bleed noun, thin bid bar' },
];

const HERO_STYLE_IDS: ReadonlySet<string> = new Set(HERO_STYLES.map(style => style.id));

export function isHeroStyle(value: unknown): value is HeroStyle {
  return typeof value === 'string' && HERO_STYLE_IDS.has(value);
}

export const DEFAULT_HERO_STYLE: HeroStyle = 'split';

export const HOME_SECTIONS_STORAGE_KEY = 'noun-wtf-home-sections';
export const HOME_HERO_STORAGE_KEY = 'noun-wtf-home-hero';

/** Sort + dedupe into canonical (config) order so equality checks are cheap. */
function normaliseSections(ids: Iterable<string>): HomeSectionId[] {
  const wanted = new Set<string>(ids);
  return HOME_SECTIONS.map(section => section.id).filter(id => wanted.has(id));
}

export function parseSectionsParam(raw: string | null | undefined): HomeSectionId[] | null {
  if (raw == null) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'all' || value === '*') return HOME_SECTIONS.map(section => section.id);
  if (value === 'none' || value === '') return [];
  // Ids are camelCase; match case-insensitively so `?sections=onchainwire` works.
  const byLower = new Map(HOME_SECTIONS.map(section => [section.id.toLowerCase(), section.id]));
  const ids = value
    .split(/[\s+,]+/)
    .map(token => byLower.get(token))
    .filter((id): id is HomeSectionId => id !== undefined);
  return normaliseSections(ids);
}

export function parseHeroParam(raw: string | null | undefined): HeroStyle | null {
  if (raw == null) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'centred') return 'centered';
  return isHeroStyle(value) ? value : null;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface HomeState {
  sections: readonly HomeSectionId[];
  heroStyle: HeroStyle;
}

function readStoredSections(): HomeSectionId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HOME_SECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normaliseSections(parsed.filter(isHomeSectionId));
  } catch {
    return [];
  }
}

function readStoredHeroStyle(): HeroStyle {
  if (typeof window === 'undefined') return DEFAULT_HERO_STYLE;
  try {
    const raw = window.localStorage.getItem(HOME_HERO_STORAGE_KEY);
    return isHeroStyle(raw) ? raw : DEFAULT_HERO_STYLE;
  } catch {
    return DEFAULT_HERO_STYLE;
  }
}

function writeStoredSections(sections: readonly HomeSectionId[]) {
  if (typeof window === 'undefined') return;
  try {
    if (sections.length === 0) {
      window.localStorage.removeItem(HOME_SECTIONS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HOME_SECTIONS_STORAGE_KEY, JSON.stringify(sections));
    }
  } catch {
    // Private mode / quota / disabled storage — preference just won't persist.
  }
}

function writeStoredHeroStyle(heroStyle: HeroStyle) {
  if (typeof window === 'undefined') return;
  try {
    if (heroStyle === DEFAULT_HERO_STYLE) {
      window.localStorage.removeItem(HOME_HERO_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HOME_HERO_STORAGE_KEY, heroStyle);
    }
  } catch {
    // ignore — see above
  }
}

function sameSections(a: readonly HomeSectionId[], b: readonly HomeSectionId[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

let state: HomeState = {
  sections: readStoredSections(),
  heroStyle: readStoredHeroStyle(),
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getHomeState(): HomeState {
  return state;
}

export function subscribeHomeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setHomeSections(next: Iterable<string>) {
  const sections = normaliseSections(next);
  if (sameSections(sections, state.sections)) return;
  state = { ...state, sections };
  writeStoredSections(sections);
  emit();
}

export function toggleHomeSection(id: HomeSectionId, enabled?: boolean) {
  const has = state.sections.includes(id);
  const want = enabled ?? !has;
  if (want === has) return;
  setHomeSections(want ? [...state.sections, id] : state.sections.filter(other => other !== id));
}

export function setHomeHeroStyle(next: HeroStyle) {
  if (next === state.heroStyle) return;
  state = { ...state, heroStyle: next };
  writeStoredHeroStyle(next);
  emit();
}

/**
 * Apply `?sections=` / `?hero=` overrides. Both seed the persisted preference
 * so a shared link sticks after the params are gone. No-op when neither param
 * is present.
 */
export function applyHomeUrlParams(search: string | URLSearchParams) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const sections = parseSectionsParam(params.get('sections'));
  if (sections !== null) setHomeSections(sections);
  const heroStyle = parseHeroParam(params.get('hero'));
  if (heroStyle !== null) setHomeHeroStyle(heroStyle);
}

if (typeof window !== 'undefined') {
  applyHomeUrlParams(window.location.search);
  // Keep tabs in sync — toggling a section in one tab updates the others.
  window.addEventListener('storage', event => {
    if (event.key === HOME_SECTIONS_STORAGE_KEY) {
      const sections = readStoredSections();
      if (!sameSections(sections, state.sections)) {
        state = { ...state, sections };
        emit();
      }
    } else if (event.key === HOME_HERO_STORAGE_KEY) {
      const heroStyle = readStoredHeroStyle();
      if (heroStyle !== state.heroStyle) {
        state = { ...state, heroStyle };
        emit();
      }
    }
  });
}

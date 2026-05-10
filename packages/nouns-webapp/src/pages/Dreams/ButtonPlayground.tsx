/**
 * Visual comparison surface for the seeded dream-card button styles.
 * Live at /dreams/buttons-playground.
 *
 * Renders 6 mock slugs × 4 variants for each of the 3 base styles
 * (Terminal / Neo-Bauhaus / Decay) so the per-slug procedural variation
 * is visible side-by-side.
 *
 * Production buttons live in `@/components/DreamButton`. The page imports
 * those directly so any tweak there shows up here automatically — no
 * style logic is duplicated. Bottom row uses the live `DreamButton`
 * dispatcher so you can see what each slug actually picks in production.
 */
import { FC } from 'react';

import {
  TerminalButton,
  BauhausButton,
  DecayButton,
  DreamButton,
  type DreamButtonVariant,
} from '@/components/DreamButton';

const MOCK_SLUGS = [
  'nounwtf-dream-1234',
  'nounwtf-dream-5678',
  'nounwtf-dream-9012',
  'nounwtf-dream-3456',
  'nounwtf-dream-7890',
  'nounwtf-dream-2468',
] as const;

const STYLES = [
  {
    key: 'terminal' as const,
    name: 'Terminal',
    blurb:
      'CRT phosphor on black. Scanline overlay, hairline border, hover bloom. Glyph top-right.',
    Component: TerminalButton,
  },
  {
    key: 'bauhaus' as const,
    name: 'Neo-Bauhaus',
    blurb: 'Muted paper fills, chamfered corners, 3px seeded accent strip on the left edge.',
    Component: BauhausButton,
  },
  {
    key: 'decay' as const,
    name: 'Decay',
    blurb: 'Cream stock with crosshatched grain, double-hairline ink-stamp border, faded glyph.',
    Component: DecayButton,
  },
];

const VARIANT_SET: Array<{ variant: DreamButtonVariant; label: string }> = [
  { variant: 'sponsor', label: 'Sponsor' },
  { variant: 'promote', label: 'Promote' },
  { variant: 'view', label: 'View' },
  { variant: 'create', label: '+ Create Dream' },
];

const ButtonPlayground: FC = () => {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-mono">
      <header className="mb-10 border-b border-neutral-300 pb-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
          dreams · buttons · playground
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Dream-card buttons</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Three base styles, each rendered against six mock dream slugs so the seeded procedural
          variation is visible side by side. Shape, size, label, and focus ring stay constant —
          only fill, border accent, and a decorative corner glyph vary per slug.
        </p>
        <p className="mt-2 max-w-2xl text-xs text-neutral-500">
          Production uses the <code>DreamButton</code> dispatcher (bottom row) which hashes the
          slug to pick a style — every dream gets a different button, the same dream always gets
          the same one.
        </p>
      </header>

      {STYLES.map(({ key, name, blurb, Component }) => (
        <section key={key} className="mb-14">
          <header className="mb-4">
            <h2 className="text-base font-bold tracking-tight">
              <span className="text-neutral-400">
                {key === 'terminal' ? '01' : key === 'bauhaus' ? '02' : '03'}
              </span>{' '}
              {name}
            </h2>
            <p className="mt-1 max-w-xl text-xs text-neutral-600">{blurb}</p>
          </header>

          <div className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            <div>slug</div>
            <div>sponsor</div>
            <div>promote</div>
            <div>view</div>
            <div>+ create</div>
          </div>

          <div className="space-y-2">
            {MOCK_SLUGS.map(slug => (
              <div
                key={slug}
                className="grid grid-cols-[110px_repeat(4,1fr)] items-center gap-3 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2"
              >
                <div className="truncate text-[10px] text-neutral-500">{slug}</div>
                {VARIANT_SET.map(({ variant, label }) => (
                  <Component
                    key={variant}
                    label={label}
                    variant={variant}
                    dreamSlug={slug}
                    onClick={() => {
                      /* illustrative only */
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Live dispatcher row — what production actually renders for each slug.
          Useful as a sanity check that the slug→style hash distributes
          reasonably across the 3 styles. */}
      <section className="mb-8 rounded-sm border-2 border-purple-300 bg-purple-50/40 p-4">
        <header className="mb-4">
          <h2 className="text-base font-bold tracking-tight">
            <span className="text-purple-400">★</span> DreamButton (live dispatcher)
          </h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-600">
            What production renders. Slug → style is FNV-1a hash, deterministic across renders.
          </p>
        </header>

        <div className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
          <div>slug</div>
          <div>sponsor</div>
          <div>promote</div>
          <div>view</div>
          <div>+ create</div>
        </div>

        <div className="space-y-2">
          {MOCK_SLUGS.map(slug => (
            <div
              key={slug}
              className="grid grid-cols-[110px_repeat(4,1fr)] items-center gap-3 rounded-sm border border-neutral-200 bg-white px-3 py-2"
            >
              <div className="truncate text-[10px] text-neutral-500">{slug}</div>
              {VARIANT_SET.map(({ variant, label }) => (
                <DreamButton
                  key={variant}
                  label={label}
                  variant={variant}
                  dreamSlug={slug}
                  onClick={() => {
                    /* illustrative only */
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-12 border-t border-neutral-300 pt-6 text-[10px] uppercase tracking-[0.3em] text-neutral-500">
        production: DreamButton picks one of {STYLES.length} styles per slug
      </footer>
    </div>
  );
};

export default ButtonPlayground;

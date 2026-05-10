/**
 * Visual comparison surface for the seeded dream-card button styles.
 * Live at /dreams/buttons-playground.
 *
 * Renders all 12 base styles (Brutalist / Win95 / Aqua / 8-bit / Neon /
 * Receipt / Neumorph / Sticker / Newspaper / Vapor / Xerox / Terminal)
 * against six mock dream slugs so the per-slug procedural variation is
 * visible side by side. Each style sets its own height/font/border/3D
 * treatment — no shared geometry. Final section runs the live
 * `DreamButton` dispatcher so you can sanity-check the slug → style hash
 * distribution.
 */
import { FC } from 'react';

import {
  DreamButton,
  STYLE_KEYS,
  STYLE_META,
  type DreamButtonVariant,
  type StyleKey,
} from '@/components/DreamButton';

const MOCK_SLUGS = [
  'nounwtf-dream-1234',
  'nounwtf-dream-5678',
  'nounwtf-dream-9012',
  'nounwtf-dream-3456',
  'nounwtf-dream-7890',
  'nounwtf-dream-2468',
] as const;

const VARIANT_SET: Array<{ variant: DreamButtonVariant; label: string }> = [
  { variant: 'sponsor', label: 'Sponsor' },
  { variant: 'promote', label: 'Promote' },
  { variant: 'view', label: 'View' },
  { variant: 'create', label: '+ Create' },
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
          Twelve wildly different button styles — different fonts, sizes, border thicknesses,
          colours, and 3D treatments. Production hashes the dream slug to pick one. Same dream
          always gets the same look across renders / sessions / users.
        </p>
        <p className="mt-2 max-w-2xl text-xs text-neutral-500">
          Within a single dream card, all action buttons share the slug so they stay coherent.
          Across cards, every dream looks different.
        </p>
      </header>

      {STYLE_KEYS.map((styleKey: StyleKey, idx: number) => (
        <section key={styleKey} className="mb-14">
          <header className="mb-4">
            <h2 className="text-base font-bold tracking-tight">
              <span className="text-neutral-400">{String(idx + 1).padStart(2, '0')}</span>{' '}
              {STYLE_META[styleKey].name}
            </h2>
            <p className="mt-1 max-w-xl text-xs text-neutral-600">
              {STYLE_META[styleKey].blurb}
            </p>
          </header>

          <div className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            <div>slug</div>
            <div>sponsor</div>
            <div>promote</div>
            <div>view</div>
            <div>+ create</div>
          </div>

          <div className="space-y-3">
            {MOCK_SLUGS.map(slug => (
              <div
                key={slug}
                className="grid grid-cols-[110px_repeat(4,1fr)] items-center gap-3 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-3"
              >
                <div className="truncate text-[10px] text-neutral-500">{slug}</div>
                {VARIANT_SET.map(({ variant, label }) => (
                  <DreamButton
                    key={variant}
                    label={label}
                    variant={variant}
                    dreamSlug={slug}
                    forceStyle={styleKey}
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

      {/* Live dispatcher — what production actually renders for each slug. */}
      <section className="mb-8 rounded-sm border-2 border-purple-300 bg-purple-50/40 p-4">
        <header className="mb-4">
          <h2 className="text-base font-bold tracking-tight">
            <span className="text-purple-400">★</span> DreamButton (live dispatcher)
          </h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-600">
            What production renders. Slug → style is FNV-1a hash mod {STYLE_KEYS.length}.
          </p>
        </header>

        <div className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
          <div>slug</div>
          <div>sponsor</div>
          <div>promote</div>
          <div>view</div>
          <div>+ create</div>
        </div>

        <div className="space-y-3">
          {MOCK_SLUGS.map(slug => (
            <div
              key={slug}
              className="grid grid-cols-[110px_repeat(4,1fr)] items-center gap-3 rounded-sm border border-neutral-200 bg-white px-3 py-3"
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
        production: DreamButton picks 1 of {STYLE_KEYS.length} styles per slug
      </footer>
    </div>
  );
};

export default ButtonPlayground;

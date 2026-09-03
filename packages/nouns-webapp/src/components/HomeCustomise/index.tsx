import { useEffect, useId, useRef, useState, type FC } from 'react';

import { useHomeSections } from '@/hooks/useHomeSections';
import { HERO_STYLES, HOME_SECTIONS } from '@/lib/homeSections';

import classes from './HomeCustomise.module.css';

/**
 * The discreet "⚙ customise" affordance for the Dice home. Opens a popover
 * (bottom sheet on mobile) listing the optional home sections + the hero
 * layout. Dependency-free: plain buttons + native checkboxes, styled to sit on
 * the light dice palette.
 */
const HomeCustomise: FC = () => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { isEnabled, toggle, enableAll, reset, heroStyle, setHeroStyle } = useHomeSections();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={classes.root}>
      <button
        type="button"
        className={`${classes.trigger} ${open ? classes.triggerOpen : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
      >
        ⚙ customise
      </button>

      {open && (
        <>
          <div className={classes.scrim} aria-hidden="true" onClick={() => setOpen(false)} />
          <div role="dialog" aria-labelledby={titleId} className={classes.panel}>
            <div className={classes.header}>
              <h2 id={titleId} className={classes.title}>
                Customise home
              </h2>
              <button
                type="button"
                className={classes.close}
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={classes.section}>
              <p className={classes.eyebrow}>Hero</p>
              <div className={classes.pills} role="radiogroup" aria-label="Hero layout">
                {HERO_STYLES.map(style => (
                  <button
                    type="button"
                    key={style.id}
                    role="radio"
                    aria-checked={heroStyle === style.id}
                    className={`${classes.pill} ${heroStyle === style.id ? classes.pillActive : ''}`}
                    onClick={() => setHeroStyle(style.id)}
                  >
                    <span className={classes.pillLabel}>{style.label}</span>
                    <span className={classes.pillHint}>{style.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={classes.section}>
              <p className={classes.eyebrow}>Sections</p>
              <ul className={classes.list}>
                {HOME_SECTIONS.map(section => (
                  <li key={section.id}>
                    <label className={classes.row}>
                      <input
                        type="checkbox"
                        className={classes.checkbox}
                        checked={isEnabled(section.id)}
                        onChange={event => toggle(section.id, event.target.checked)}
                      />
                      <span>
                        <span className={classes.rowLabel}>{section.label}</span>
                        <span className={classes.rowHint}>{section.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className={classes.footer}>
              <button type="button" className={classes.textBtn} onClick={enableAll}>
                Show everything
              </button>
              <button type="button" className={classes.textBtn} onClick={reset}>
                Reset
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default HomeCustomise;

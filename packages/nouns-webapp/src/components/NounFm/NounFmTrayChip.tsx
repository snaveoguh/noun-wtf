import { useSyncExternalStore } from 'react';

import { nounFm } from './NounFmStation';

/**
 * NOUN FM's "off" button as a NounOS tray chip. On the desk the floating pill
 * (NounFmWidget) is hidden and this chip stands in for it, so nothing floats
 * over page content; once tuned in, the widget's player tile takes over.
 */
export default function NounFmTrayChip() {
  const fm = nounFm();
  const v = useSyncExternalStore(fm.subscribe, fm.getView);
  if (v.phase !== 'off') return null;
  return (
    <button
      type="button"
      className="nos-chip"
      onClick={() => fm.tuneIn()}
      title="NOUN FM: our jingles between deep cuts, videos and podcasts"
      data-nounfm-chip=""
    >
      <span aria-hidden>📻</span>
      {v.wasOn ? '▶ FM' : 'FM'}
    </button>
  );
}

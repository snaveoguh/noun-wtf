import ClassicAuction from './ClassicAuction';
import ClassicShell from './index';

/**
 * Bespoke home for the Classic theme — minimal port of OG nouns.wtf.
 * Locked to the live mainnet auction in a single above-the-fold view.
 * No marketing bands, no archive, no V2 toggle.
 */
export default function ClassicHome() {
  return (
    <ClassicShell>
      <ClassicAuction />
    </ClassicShell>
  );
}

// ── SHARE: one icon in the HUD's utility row, two actions under the ring ───
//
// PLAY-AS LINK casts / shares / copies noun.wtf/world?seed=<your rider>
// (it unfurls as your rider with PLAY AS ME); SNAPSHOT grabs the frame with
// the link along the bottom. Uses the HUD's own pieces (IconButton, the
// missions panel's w2-mtrack look, the toast stack), no new styles.

import type { Game } from '../Game';

import { useEffect, useState } from 'react';

import { IconButton } from '../hud/IconButton';
import { HudSlot } from '../hud/slots';

import { playAsUrl } from './playLink';
import { captureSnapshot, shareName, shareOrigin, shareRider, shareSnapshot } from './share';

const SAID: Record<string, string> = {
  cast: 'Cast ready: post it',
  shared: 'Shared',
  copied: 'Play-as link copied',
  failed: "Couldn't share: try again",
  downloaded: 'Snapshot saved',
};

export function ShareUi({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const run = async (what: 'link' | 'snap') => {
    if (busy) return;
    setBusy(true);
    try {
      if (what === 'link') {
        setToast(SAID[await shareRider(game.seed, game.name)]!);
      } else {
        const link = playAsUrl(game.seed, {
          name: shareName(game.name),
          origin: shareOrigin(location),
        });
        const blob = await captureSnapshot(
          game.gfx.renderer.domElement,
          () => game.gfx.render(1 / 60),
          link,
        );
        setToast(blob === null ? SAID.failed! : SAID[await shareSnapshot(blob, link)]!);
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <HudSlot name="util">
        <IconButton
          icon="share"
          on={open}
          label="Share: a play-as link for your rider, or a snapshot"
          onClick={() => setOpen(o => !o)}
          data={{ 'data-w2share': 'open' }}
        />
      </HudSlot>
      {open && (
        <HudSlot name="panels">
          <div data-w2hud="share" className="w2-mtrack w-[210px]">
            <div className="w2-mhead">
              <span>⌐◨-◨ SHARE</span>
            </div>
            <div className="w2-mlist">
              <button
                type="button"
                className="w2-mrow text-left"
                data-w2share="link"
                disabled={busy}
                onClick={() => void run('link')}
              >
                <b>PLAY-AS LINK</b>
                <small>friends drop in as your rider</small>
              </button>
              <button
                type="button"
                className="w2-mrow text-left"
                data-w2share="snap"
                disabled={busy}
                onClick={() => void run('snap')}
              >
                <b>SNAPSHOT</b>
                <small>this moment, with the link on it</small>
              </button>
            </div>
          </div>
        </HudSlot>
      )}
      {toast !== null && (
        <HudSlot name="toasts">
          <div className="w2-mtrack" data-w2share="toast">
            {toast}
          </div>
        </HudSlot>
      )}
    </>
  );
}

import { useState, useSyncExternalStore } from 'react';

import { installState, promptInstall, subscribeInstall } from './install';

const serverState = () => 'none' as const;

/** "Install app" (Chromium's prompt) or the iOS "Add to Home Screen" hint; nothing once installed. */
export function InstallButton({ className = '' }: { className?: string }) {
  const state = useSyncExternalStore(subscribeInstall, installState, serverState);
  const [hint, setHint] = useState(false);
  if (state === 'installed' || state === 'none') return null;
  if (state === 'prompt')
    return (
      <button
        type="button"
        className={`w2-sel rounded-full bg-[#ffd400] px-3 py-1.5 text-xs font-bold text-black ${className}`}
        onClick={() => void promptInstall()}
        data-w2install=""
      >
        📲 INSTALL APP
      </button>
    );
  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <button
        type="button"
        className="w2-sel rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold"
        onClick={() => setHint(h => !h)}
        aria-expanded={hint}
        data-w2install=""
      >
        📲 ADD TO HOME SCREEN
      </button>
      {hint && (
        <div className="max-w-[260px] rounded-xl bg-black/70 px-3 py-2 text-center text-xs leading-snug">
          Tap <b>Share</b> (the square with the arrow) in Safari, then <b>Add to Home Screen</b>.
          Noun World opens full screen like an app.
        </div>
      )}
    </div>
  );
}

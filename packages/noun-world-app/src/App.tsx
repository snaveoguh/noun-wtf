import { useState } from 'react';

import World2Page from '@/miniapps/world2/World2Page';
import { MemoryRouter, Route, Routes } from 'react-router';

import { loadSettings } from './controls/settings';
import { TouchLayer } from './controls/TouchLayer';
import { DownhillRun } from './downhill/DownhillRun';
import { type AppMode, Launcher } from './Launcher';
import { clearGame, useGame } from './useGame';

/**
 * The game page reads `?seed`, `?q`, `?skip`… from the router and navigates
 * to /world/classic on a fatal WebGL error. A memory router keeps both
 * working without a URL bar; the classic route is just a retry screen here.
 */
export default function App() {
  const [mode, setMode] = useState<AppMode | null>(null);
  const [settings, setSettings] = useState(() => loadSettings());
  const game = useGame();

  const toMenu = () => {
    clearGame();
    setMode(null);
  };

  return (
    <>
      {mode === null ? (
        <Launcher settings={settings} onSettings={setSettings} onPick={setMode} />
      ) : (
        <>
          <MemoryRouter key={mode} initialEntries={['/world']}>
            <Routes>
              <Route path="/world" element={<World2Page />} />
              <Route path="/world/classic" element={<Fallback />} />
              <Route path="*" element={<World2Page />} />
            </Routes>
          </MemoryRouter>
          <TouchLayer
            game={game}
            settings={settings}
            onSettings={setSettings}
            onMenu={toMenu}
            plazaButtons={mode === 'plaza'}
          />
          {mode === 'downhill' && <DownhillRun game={game} onMenu={toMenu} />}
        </>
      )}
      <div className="nw-rotate">
        <div>↻</div>
        <div>rotate your phone</div>
        <div style={{ fontSize: 16, opacity: 0.7 }}>Noun World plays in landscape</div>
      </div>
    </>
  );
}

function Fallback() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d1117] p-6 text-center text-white"
      style={{ fontFamily: "'Londrina Solid', system-ui, sans-serif" }}
    >
      <div className="text-3xl">this device can&apos;t run Noun World</div>
      <div className="opacity-70">WebGL 2 is required</div>
      <button
        type="button"
        className="rounded-xl bg-[#d22209] px-6 py-3 text-xl"
        onClick={() => window.location.reload()}
      >
        try again
      </button>
    </div>
  );
}

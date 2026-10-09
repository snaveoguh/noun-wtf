import World2Page from '@/miniapps/world2/World2Page';
import { MemoryRouter, Route, Routes } from 'react-router';

/**
 * The game page reads `?seed`, `?q`, `?skip`… from the router and navigates
 * to /world/classic on a fatal WebGL error. A memory router keeps both
 * working without a URL bar; the classic route is just a retry screen here.
 */
export default function App() {
  return (
    <MemoryRouter initialEntries={['/world']}>
      <Routes>
        <Route path="/world" element={<World2Page />} />
        <Route path="/world/classic" element={<Fallback />} />
        <Route path="*" element={<World2Page />} />
      </Routes>
      <div className="nw-rotate">
        <div>↻</div>
        <div>rotate your phone</div>
        <div style={{ fontSize: 16, opacity: 0.7 }}>Noun World plays in landscape</div>
      </div>
    </MemoryRouter>
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

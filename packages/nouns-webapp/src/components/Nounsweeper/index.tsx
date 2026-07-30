/**
 * Nounsweeper — Minesweeper, but the mines are Nouns.
 *
 * Shown while the indexer is reindexing (every `railway up` starts a fresh
 * Ponder schema, so all data endpoints are empty for ~10-15 min). Rather than
 * a blank site, give people something to do. Dismissible; the banner stays so
 * they can reopen it.
 *
 * Self-contained: no deps, no network, no assets.
 */
import { FC, useCallback, useEffect, useState } from 'react';

type Cell = {
  noun: boolean; // "mine"
  revealed: boolean;
  flagged: boolean;
  n: number; // adjacent nouns
};

const W = 9;
const H = 9;
const NOUNS = 10;

const NUM_COLORS = ['', '#2563eb', '#15803d', '#c54e38', '#6d28d9', '#a16207', '#0e7490', '#111', '#666'];

function build(): Cell[][] {
  const g: Cell[][] = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => ({ noun: false, revealed: false, flagged: false, n: 0 })),
  );
  let placed = 0;
  while (placed < NOUNS) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * H);
    if (!g[y][x].noun) {
      g[y][x].noun = true;
      placed++;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x].noun) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && g[ny][nx].noun) n++;
        }
      g[y][x].n = n;
    }
  }
  return g;
}

const Nounsweeper: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [grid, setGrid] = useState<Cell[][]>(build);
  const [dead, setDead] = useState(false);
  const [won, setWon] = useState(false);

  const reset = useCallback(() => {
    setGrid(build());
    setDead(false);
    setWon(false);
  }, []);

  const reveal = (x: number, y: number) => {
    if (dead || won) return;
    setGrid(prev => {
      const g = prev.map(r => r.map(c => ({ ...c })));
      if (g[y][x].flagged || g[y][x].revealed) return prev;
      if (g[y][x].noun) {
        g.forEach(r => r.forEach(c => c.noun && (c.revealed = true)));
        setDead(true);
        return g;
      }
      // flood-fill the zeros
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        const cell = g[cy][cx];
        if (cell.revealed || cell.flagged) continue;
        cell.revealed = true;
        if (cell.n === 0) {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const ny = cy + dy;
              const nx = cx + dx;
              if (ny >= 0 && ny < H && nx >= 0 && nx < W && !g[ny][nx].revealed) stack.push([nx, ny]);
            }
        }
      }
      const safe = g.flat().filter(c => !c.noun);
      if (safe.every(c => c.revealed)) setWon(true);
      return g;
    });
  };

  const flag = (e: React.MouseEvent, x: number, y: number) => {
    e.preventDefault();
    if (dead || won) return;
    setGrid(prev => {
      const g = prev.map(r => r.map(c => ({ ...c })));
      if (!g[y][x].revealed) g[y][x].flagged = !g[y][x].flagged;
      return g;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flags = grid.flat().filter(c => c.flagged).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(10,10,16,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#f4f0ea',
          border: '3px solid #14141f',
          borderRadius: 14,
          padding: 16,
          maxWidth: 380,
          width: '100%',
          fontFamily: "'PT Root UI', ui-monospace, monospace",
          boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <strong style={{ fontSize: '1.05rem' }}>NOUNSWEEPER</strong>
          <button
            onClick={onClose}
            style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
            aria-label="close"
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: '0.78rem', color: '#79809c', margin: '0 0 10px' }}>
          The indexer is rebuilding — data will be back in a few minutes. Don&apos;t click the Nouns.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.8rem' }}>
          <span>⌐◨-◨ {NOUNS - flags}</span>
          <button
            onClick={reset}
            style={{
              border: '1px solid #14141f',
              background: '#fff',
              borderRadius: 6,
              padding: '2px 10px',
              cursor: 'pointer',
              fontSize: '0.78rem',
            }}
          >
            {dead ? 'try again' : won ? 'again' : 'reset'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${W}, 1fr)`, gap: 2 }}>
          {grid.map((row, y) =>
            row.map((c, x) => (
              <button
                key={`${x}-${y}`}
                onClick={() => reveal(x, y)}
                onContextMenu={e => flag(e, x, y)}
                style={{
                  aspectRatio: '1',
                  border: c.revealed ? '1px solid #ddd8d0' : '1px solid #14141f',
                  background: c.revealed ? (c.noun ? '#c54e38' : '#fffdfa') : '#e2ddd4',
                  borderRadius: 3,
                  cursor: dead || won ? 'default' : 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: NUM_COLORS[c.n] || '#111',
                  fontFamily: 'inherit',
                }}
              >
                {c.revealed ? (c.noun ? '⌐◨-◨' : c.n > 0 ? c.n : '') : c.flagged ? '🚩' : ''}
              </button>
            )),
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 10, fontSize: '0.8rem', minHeight: 20 }}>
          {dead && <span style={{ color: '#c54e38', fontWeight: 700 }}>you clicked a Noun. it went to the treasury.</span>}
          {won && <span style={{ color: '#15803d', fontWeight: 700 }}>swept. ⌐◨-◨</span>}
        </div>
      </div>
    </div>
  );
};

export default Nounsweeper;

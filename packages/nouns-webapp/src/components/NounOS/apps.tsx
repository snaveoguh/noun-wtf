import { useEffect, useMemo, useState } from 'react';

import { formatEther } from 'viem';

import { StandaloneNounImage } from '@/components/StandaloneNoun';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';

import { CATALOG, type Entry } from './catalog';

// ── README_CAPTURED.TXT ─────────────────────────────────────────────────

export function Manifesto({
  onEnterWorld,
  onOpen,
}: {
  onEnterWorld: () => void;
  onOpen: (e: Entry) => void;
}) {
  return (
    <article className="nos-manifesto">
      <p className="nos-mono-dim">noun.wtf // transmission 001 // cc0, copy this</p>
      <h1>
        THE DAO
        <br />
        HAS BEEN
        <br />
        <span className="nos-stamp">CAPTURED</span>
      </h1>
      <p>
        You already know. The tokens got bought up by people who saw a treasury, not a culture. They
        will vote through whatever spreadsheet they were handed. They will call it governance.
      </p>
      <p>
        They bought the nouns, then <b>pulled the ladder up behind them</b>. Fine.
      </p>
      <p className="nos-big">
        You can buy the votes.
        <br />
        You can&apos;t buy the essence.
      </p>
      <p>
        Being nounish was never a balance. It was one noun a day, forever. It was public domain art
        that anyone could pick up and run with. It was skating the plaza at 3am with strangers. It
        was proliferation, not permission.
      </p>
      <p>
        So this is the other side of the glass. No roadmap, no brand guidelines, no committee. Just
        the art, the world, the feed, and whoever is online right now.
      </p>
      <ul className="nos-tenets">
        <li>⌐◨-◨ nouns is forever. the capture is temporary.</li>
        <li>⌐◨-◨ cc0 means it&apos;s already ours.</li>
        <li>⌐◨-◨ make things, not proposals about making things.</li>
        <li>⌐◨-◨ the network is the church. log on.</li>
      </ul>
      <div className="nos-row">
        <button type="button" className="nos-btn is-acid" onClick={onEnterWorld}>
          ENTER NOUN WORLD →
        </button>
        <button type="button" className="nos-btn" onClick={() => onOpen(CATALOG[0]!.entries[0]!)}>
          SEE THE ART (PIP3)
        </button>
      </div>
      <p className="nos-mono-dim">— the underground. we are punk. nouns is forever.</p>
    </article>
  );
}

// ── INDEX (the mega page) ───────────────────────────────────────────────

export function Directory({ onOpen }: { onOpen: (e: Entry) => void }) {
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s === '') return CATALOG;
    return CATALOG.map(sec => ({
      ...sec,
      entries: sec.entries.filter(
        e => e.name.toLowerCase().includes(s) || e.blurb.toLowerCase().includes(s),
      ),
    })).filter(sec => sec.entries.length > 0);
  }, [q]);

  return (
    <div className="nos-dir">
      <div className="nos-dir-head">
        <div>
          <div className="nos-wordmark">NOUN.WTF</div>
          <div className="nos-mono-dim">
            an underground index of everything nounish · est. day 1 · forever
          </div>
        </div>
        <input
          className="nos-input"
          placeholder="search the index…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="nos-dir-grid">
        {sections.map(sec => (
          <section key={sec.id} className={`nos-dir-sec sec-${sec.id}`}>
            <h2>
              {sec.title} <span>{sec.tag}</span>
            </h2>
            <ul>
              {sec.entries.map(e => (
                <li key={e.path}>
                  <button type="button" onClick={() => onOpen(e)}>
                    <b>
                      {e.hot === true && <i className="nos-hot">NEW</i>}
                      {e.name}
                    </b>
                    <span>{e.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="nos-mono-dim nos-dir-foot">
        best viewed with headphones on · webring: ⌐◨-◨ ← noun.wtf → ⌐◨-◨ · you are visitor #∞
      </p>
    </div>
  );
}

// ── Auction tray chip + hover card ─────────────────────────────────────

function timeLeft(end: number) {
  const r = end - Math.floor(Date.now() / 1000);
  if (r <= 0) return 'settling';
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const s = r % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

function eth(v: unknown) {
  try {
    const n = typeof v === 'bigint' ? v : BigInt(String(v));
    const f = Number(formatEther(n));
    return `Ξ ${f < 10 ? f.toFixed(2) : f.toFixed(1)}`;
  } catch {
    return 'Ξ —';
  }
}

export function AuctionChip({ onOpen }: { onOpen: (path: string) => void }) {
  const auction = useOnDisplayAuction();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick(x => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const id = useMemo(() => {
    try {
      return auction?.nounId !== undefined ? BigInt(auction.nounId.toString()) : undefined;
    } catch {
      return undefined;
    }
  }, [auction?.nounId]);
  if (id === undefined || auction === undefined) {
    return <span className="nos-chip is-dim">AUCTION …</span>;
  }
  const end = Number(auction.endTime ?? 0);
  return (
    <span className="nos-auction">
      <button type="button" className="nos-chip" onClick={() => onOpen(`/noun/${id}`)}>
        <span className="nos-auction-thumb">
          <StandaloneNounImage nounId={id} />
        </span>
        NOUN {String(id)} · {eth(auction.amount)} · {timeLeft(end)}
      </button>
      <span className="nos-auction-card" role="tooltip">
        <span className="nos-auction-img">
          <StandaloneNounImage nounId={id} />
        </span>
        <span className="nos-auction-meta">
          <b>NOUN {String(id)}</b>
          <span>current bid</span>
          <strong>{eth(auction.amount)}</strong>
          <span>ends in</span>
          <strong>{timeLeft(end)}</strong>
          <button type="button" className="nos-btn is-acid" onClick={() => onOpen(`/noun/${id}`)}>
            BID →
          </button>
        </span>
      </span>
    </span>
  );
}

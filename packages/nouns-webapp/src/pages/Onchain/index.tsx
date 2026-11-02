// /onchain — Noun World on Base. Once a day the snapshot job commits a
// Merkle root of every graffiti piece and every leaderboard row to
// NounWorldLedger; this page lists those versions and lets anyone check that
// a piece or a record is in one: it fetches the manifest and the piece's own
// file from IPFS / Arweave, rebuilds the tree, and asks the contract.

import type { Hex } from 'viem';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { EXPLORER, KIND_NAME, type LedgerVersion } from '@/miniapps/world2/onchain/contract';
import {
  checkManifest,
  type GraffitiPiece,
  type Manifest,
  type ManifestLeaf,
  type RecordRow,
} from '@/miniapps/world2/onchain/snapshot';

import { chainVerify, dirOf, fetchJson, httpUrl, ledgerTarget, readVersions } from './ledger';
import { ONCHAIN_CSS } from './styles';
import { checkLeaf, layoutTag, paintBounds, searchLeaves, short, type LeafCheck } from './verify';

const target = ledgerTarget();
const CHAIN_NAME: Record<number, string> = { 8453: 'Base', 84532: 'Base Sepolia' };

const dateOf = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function KindBadge({ kind }: { kind: number }) {
  const name = KIND_NAME[kind] ?? `kind ${kind}`;
  const cls =
    name === 'graffiti'
      ? 'bg-[#ff2f8e] text-black'
      : name === 'records'
        ? 'bg-[#20d6ff] text-black'
        : 'bg-white/20';
  return (
    <span className={`oc-mono rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {name}
    </span>
  );
}

function Tick({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const mark = ok === null ? '…' : ok ? '✓' : '✗';
  const cls = ok === null ? 'text-[#ffd400]' : ok ? 'text-[#3dff8a]' : 'text-[#ff3b3b]';
  return (
    <li className="flex gap-2 text-[13px]">
      <span className={`oc-mono w-4 shrink-0 font-bold ${cls}`} aria-hidden>
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

function TagCanvas({ piece }: { piece: GraffitiPiece }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => layoutTag(piece.data, piece.hidden), [piece]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !layout) return;
    const W = 640;
    const H = 400;
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    // Zoom to the paint (with room around it), never past the whole cell
    const b = paintBounds(layout.strokes);
    const view = b ?? { x0: 0, y0: 0, x1: layout.w, y1: layout.h };
    const pad = 300;
    let vw = Math.max(1600, view.x1 - view.x0 + pad * 2);
    let vh = Math.max(1000, view.y1 - view.y0 + pad * 2);
    if (vw / vh > W / H) vh = (vw * H) / W;
    else vw = (vh * W) / H;
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const scale = W / vw;
    g.setTransform(scale, 0, 0, scale, W / 2 - cx * scale, H / 2 - cy * scale);
    g.clearRect(cx - vw, cy - vh, vw * 2, vh * 2);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of layout.strokes) {
      g.globalAlpha = s.alpha;
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.lineWidth = Math.max(1 / scale, s.r * 2);
      g.beginPath();
      if (s.pts.length === 4 && s.pts[0] === s.pts[2] && s.pts[1] === s.pts[3]) {
        g.arc(s.pts[0], s.pts[1], Math.max(1 / scale, s.r), 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) g.lineTo(s.pts[i], s.pts[i + 1]);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }, [layout]);
  if (!layout) return null;
  return (
    <canvas
      ref={ref}
      className="oc-wall block h-auto w-full rounded-xl"
      aria-label={`Graffiti piece ${piece.tagId ?? ''}, ${piece.strokes} strokes`}
    />
  );
}

function PieceInfo({ file }: { file: unknown }) {
  const f = file as { type?: unknown } | null;
  if (f?.type === 'graffiti') {
    const p = f as GraffitiPiece;
    return (
      <div className="space-y-3">
        <TagCanvas piece={p} />
        <dl className="oc-mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-[#9b998f]">
          <dt>level</dt>
          <dd className="text-[#f4f2ea]">{p.level}</dd>
          <dt>wall</dt>
          <dd className="oc-break text-[#f4f2ea]">
            normal ({p.surface.normal.join(', ')}) · d {p.surface.d} · cell{' '}
            {p.surface.cell.join(', ')}
          </dd>
          {p.tagId && (
            <>
              <dt>tag</dt>
              <dd className="text-[#f4f2ea]">{p.tagId}</dd>
            </>
          )}
          <dt>strokes</dt>
          <dd className="text-[#f4f2ea]">
            {p.strokes}
            {(p.hidden?.length ?? 0) > 0 ? ` (${p.hidden!.length} taken down)` : ''}
          </dd>
          <dt>sprayed</dt>
          <dd className="text-[#f4f2ea]">
            {p.createdAt ? new Date(p.createdAt).toLocaleString() : 'before times were kept'}
          </dd>
        </dl>
      </div>
    );
  }
  if (f?.type === 'record') {
    const r = f as RecordRow;
    return (
      <div className="rounded-xl bg-white/[.05] p-4">
        <div className="oc-mono text-[11px] uppercase text-[#9b998f]">
          {r.metric} · #{r.rank}
        </div>
        <div className="oc-pip3 mt-1 text-4xl text-[#d4ff3a]">{r.value.toLocaleString()}</div>
        <div className="mt-1 text-[15px] font-bold">
          {r.name}
          {r.title ? (
            <span className="ml-2 text-[12px] font-normal text-[#9b998f]">{r.title}</span>
          ) : null}
        </div>
        {r.label && <div className="text-[12px] text-[#9b998f]">{r.label}</div>}
        {r.addr && <div className="oc-mono oc-break mt-1 text-[11px] text-[#9b998f]">{r.addr}</div>}
      </div>
    );
  }
  return null;
}

function LeafDetail({
  version,
  man,
  leaf,
}: {
  version: LedgerVersion;
  man: Manifest;
  leaf: ManifestLeaf;
}) {
  const check = useMemo(() => checkManifest(man, version.root as Hex), [man, version.root]);
  const fileQ = useQuery({
    queryKey: ['onchain-file', version.uri, leaf.file],
    queryFn: () => fetchJson(`${dirOf(version.uri)}/${leaf.file}`),
    staleTime: Infinity,
  });
  const local: LeafCheck | null = useMemo(
    () =>
      fileQ.data !== undefined && check.tree ? checkLeaf(man, check.tree, leaf, fileQ.data) : null,
    [fileQ.data, check.tree, man, leaf],
  );
  const chainQ = useQuery({
    queryKey: ['onchain-verify', version.index, local?.leaf],
    queryFn: () => chainVerify(target, version.index, local!.leaf, local!.proof ?? []),
    enabled: local !== null && local.proof !== null,
    staleTime: Infinity,
  });
  return (
    <div className="space-y-4">
      {fileQ.data !== undefined && <PieceInfo file={fileQ.data} />}
      <ul className="m-0 list-none space-y-1.5 p-0">
        <Tick ok={fileQ.isError ? false : local ? local.contentOk : null}>
          {fileQ.isError
            ? `couldn't fetch the file (${(fileQ.error as Error).message})`
            : 'the file hashes to its leaf in the manifest'}
        </Tick>
        <Tick ok={local ? local.proofOk : null}>
          its Merkle proof reaches version #{version.index}&apos;s root (checked here)
        </Tick>
        <Tick ok={chainQ.isError ? false : (chainQ.data ?? null)}>
          NounWorldLedger.verify({version.index}, leaf, proof) on {CHAIN_NAME[target.chainId]} says
          yes
        </Tick>
      </ul>
      {local?.proof && (
        <details className="rounded-xl bg-white/[.04] p-3">
          <summary className="oc-mono cursor-pointer text-[11px] text-[#9b998f]">
            proof ({local.proof.length} hashes)
          </summary>
          <pre className="oc-mono oc-break mt-2 whitespace-pre-wrap text-[10.5px] text-[#f4f2ea]">
            {JSON.stringify(
              { index: version.index, leaf: local.leaf, proof: local.proof },
              null,
              1,
            )}
          </pre>
        </details>
      )}
      <a
        href={httpUrl(`${dirOf(version.uri)}/${leaf.file}`)}
        target="_blank"
        rel="noreferrer"
        className="oc-mono inline-block text-[11px] text-[#20d6ff] underline"
      >
        open the file
      </a>
    </div>
  );
}

function VersionPanel({ version, initialQuery }: { version: LedgerVersion; initialQuery: string }) {
  const manQ = useQuery({
    queryKey: ['onchain-manifest', version.uri],
    queryFn: () => fetchJson(version.uri) as Promise<Manifest>,
    staleTime: Infinity,
  });
  const check = useMemo(
    () => (manQ.data ? checkManifest(manQ.data, version.root as Hex) : null),
    [manQ.data, version.root],
  );
  const [q, setQ] = useState(initialQuery);
  const [picked, setPicked] = useState<string | null>(null);
  const results = useMemo(
    () => (manQ.data !== undefined && check?.ok === true ? searchLeaves(manQ.data, q) : []),
    [manQ.data, check, q],
  );
  const leaf = picked !== null ? manQ.data?.leaves.find(l => l.key === picked) : undefined;
  const isGraffiti = KIND_NAME[version.kind] === 'graffiti';

  return (
    <section className="@sm:p-6 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={version.kind} />
        <h2 className="oc-pip3 m-0 text-2xl">Version #{version.index}</h2>
        <span className="text-[12px] text-[#9b998f]">{dateOf(version.timestamp)}</span>
      </div>
      <div className="oc-mono oc-break mt-2 text-[11px] text-[#9b998f]">
        root {version.root} ·{' '}
        <a
          href={httpUrl(version.uri)}
          target="_blank"
          rel="noreferrer"
          className="text-[#20d6ff] underline"
        >
          {version.uri}
        </a>
      </div>
      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        <Tick ok={manQ.isError ? false : check ? check.ok : null}>
          {manQ.isError
            ? `couldn't fetch the manifest (${(manQ.error as Error).message})`
            : check && !check.ok
              ? check.reason
              : `the manifest's ${manQ.data?.count.toLocaleString() ?? ''} leaves rebuild the on-chain root`}
        </Tick>
      </ul>

      {check?.ok === true && (
        <div className="@lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mt-5 grid gap-5">
          <div className="min-w-0">
            <label className="block">
              <span className="oc-mono text-[11px] text-[#9b998f]">
                {isGraffiti
                  ? 'paste your tag (g3:…), its tag id, or a wall'
                  : 'rider name, address or board (kmh, airM, …)'}
              </span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={isGraffiti ? 'g3:AdnY… or d9d879b97523 or plaza|' : 'name or 0x…'}
                className="oc-mono mt-1 w-full px-3 py-2 text-[13px] [@media(pointer:coarse)]:min-h-10"
              />
            </label>
            <ul className="m-0 mt-3 max-h-[420px] list-none space-y-1 overflow-y-auto p-0 pr-1">
              {results.map(l => (
                <li key={l.key}>
                  <button
                    type="button"
                    onClick={() => setPicked(l.key)}
                    aria-pressed={picked === l.key}
                    className={`oc-mono w-full rounded-lg border-0 px-3 py-2 text-left text-[11px] transition ${picked === l.key ? 'bg-[#d4ff3a] text-black' : 'bg-white/[.05] text-[#f4f2ea] hover:bg-white/10'}`}
                  >
                    <span className="font-bold">
                      {l.label ?? (isGraffiti ? 'legacy tag' : short(l.content))}
                    </span>
                    <span className="oc-break block opacity-70">{l.key}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="text-[13px] text-[#9b998f]">Nothing in this version matches.</li>
              )}
            </ul>
          </div>
          <div className="min-w-0">
            {leaf ? (
              <LeafDetail key={leaf.key} version={version} man={manQ.data!} leaf={leaf} />
            ) : (
              <p className="text-[13px] text-[#9b998f]">Pick one to check it against the chain.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function OnchainPage() {
  const [params, setParams] = useSearchParams();
  const versionsQ = useQuery({
    queryKey: ['onchain-versions', target.chainId, target.address],
    queryFn: () => readVersions(target),
    enabled: target.address !== null,
    staleTime: 60_000,
  });
  const versions = versionsQ.data ?? [];
  const wanted = params.get('v');
  const selected = versions.find(v => String(v.index) === wanted) ?? versions[0];
  const explorer = EXPLORER[target.chainId];

  return (
    <div className="oc-root min-h-full w-full max-w-full overflow-x-hidden bg-[#07070a] text-[#f4f2ea]">
      <style>{ONCHAIN_CSS}</style>
      <header className="@md:px-8 @md:pt-10 px-4 pb-6 pt-8">
        <div>
          <span className="oc-strap oc-mono">
            NOUN WORLD · ON {CHAIN_NAME[target.chainId].toUpperCase()}
          </span>
        </div>
        <h1 className="oc-title oc-pip3 mb-0 mt-6">
          <span>On</span>
          <span className="is-acc">chain</span>
        </h1>
        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-[#cfcdc4]">
          Once a day every graffiti piece on Noun World&apos;s walls and every leaderboard record is
          saved to IPFS / Arweave, and a fingerprint of the lot (a Merkle root) is written to a
          contract on Base. Versions are append-only: nobody can edit or delete one, us included.
          Find your piece or record below to prove it was there.
        </p>
        <div className="oc-mono mt-4 text-[11px] text-[#9b998f]">
          {target.address ? (
            <>
              NounWorldLedger{' '}
              <a
                href={`${explorer}/address/${target.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#20d6ff] underline"
              >
                {target.address}
              </a>
            </>
          ) : (
            'NounWorldLedger is not deployed yet: versions show up here after the first daily commit.'
          )}
        </div>
      </header>

      <main className="@md:px-8 space-y-6 px-4 pb-16">
        {target.address && (
          <section>
            <h2 className="oc-pip3 mb-3 text-xl">Versions</h2>
            {versionsQ.isLoading && (
              <p className="text-[13px] text-[#9b998f]">Reading the ledger…</p>
            )}
            {versionsQ.isError && (
              <p className="text-[13px] text-[#ff3b3b]">
                Couldn&apos;t read the ledger ({(versionsQ.error as Error).message}).
              </p>
            )}
            {versionsQ.isSuccess && versions.length === 0 && (
              <p className="text-[13px] text-[#9b998f]">
                No versions yet. The first daily snapshot lands soon.
              </p>
            )}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {versions.map(v => (
                <button
                  key={v.index}
                  type="button"
                  onClick={() =>
                    setParams(p => (p.set('v', String(v.index)), p), { replace: true })
                  }
                  aria-pressed={selected?.index === v.index}
                  className={`shrink-0 rounded-xl border-0 px-3 py-2 text-left transition ${selected?.index === v.index ? 'bg-[#d4ff3a] text-black' : 'bg-white/[.06] text-[#f4f2ea] hover:bg-white/10'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="oc-mono text-[12px] font-bold">#{v.index}</span>
                    <KindBadge kind={v.kind} />
                  </div>
                  <div className="oc-mono mt-1 text-[10.5px] opacity-75">{dateOf(v.timestamp)}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {selected !== undefined && (
          <VersionPanel
            key={selected.index}
            version={selected}
            initialQuery={params.get('q') ?? ''}
          />
        )}

        <section className="@lg:grid-cols-3 grid gap-4">
          {[
            [
              '1 · Snapshot',
              'Each graffiti piece (its strokes, wall, tag id, when it went up) and each board row (name, linked address, value) becomes a small JSON file.',
            ],
            [
              '2 · Store',
              "The files and a manifest listing every file's hash go to IPFS or Arweave. Pieces that didn't change keep the same address.",
            ],
            [
              '3 · Commit',
              "The Merkle root of those hashes goes to NounWorldLedger on Base with the manifest's address. A proof is the handful of hashes from your piece up to that root.",
            ],
          ].map(([h, t]) => (
            <div key={h} className="rounded-2xl bg-white/[.04] p-4">
              <div className="oc-pip3 text-lg text-[#d4ff3a]">{h}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-[#cfcdc4]">{t}</p>
            </div>
          ))}
        </section>
        <p className="text-[12px] text-[#9b998f]">
          Positions are only ever saved as part of a daily snapshot (which wall a piece is on),
          never live. Records carry what the public leaderboards already show; private rider ids and
          graffiti undo keys are never published.
        </p>
      </main>
    </div>
  );
}

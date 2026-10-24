import type { Cc0Asset } from './assets';

import { useEffect, useRef, useState } from 'react';

import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  DownloadIcon as Download,
  ExternalLinkIcon as ExternalLink,
  FlagIcon as Flag,
  Link2Icon as Link2,
  XIcon as X,
} from 'lucide-react';
import { createPortal } from 'react-dom';

import { AssetImage, FileTile } from './AssetCard';
import { formatBytes, SOURCE_LABEL, TYPE_LABEL } from './assets';
import { reportUpload } from './submit';

export const CC0_DEED = 'https://creativecommons.org/publicdomain/zero/1.0/';

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2 border-b border-white/[.06] py-2 text-[13px]">
      <dt className="cc0-mono pt-px text-[10.5px] font-bold text-[#9b998f]">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-[#f4f2ea]">{children}</dd>
    </div>
  );
}

function ReportBox({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  if (state === 'sent')
    return <p className="m-0 text-[12.5px] text-[#9b998f]">Thanks. A moderator will look at it.</p>;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border-0 bg-transparent px-0 text-[12.5px] text-[#9b998f] underline-offset-2 hover:text-[#ff2f8e] hover:underline"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden /> Report this upload
      </button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={e => {
        e.preventDefault();
        setState('sending');
        void reportUpload(id, reason).then(r => setState(r.ok ? 'sent' : r.error));
      }}
    >
      <label className="text-[12.5px] text-[#9b998f]" htmlFor="cc0-report">
        What&apos;s wrong with it? (not theirs, not CC0, nasty…)
      </label>
      <input
        id="cc0-report"
        value={reason}
        maxLength={300}
        onChange={e => setReason(e.target.value)}
        className="h-10 px-3 text-[14px]"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-full border-0 bg-[#ff2f8e] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="border-0 bg-transparent text-[13px] text-[#9b998f]"
        >
          Cancel
        </button>
      </div>
      {state !== 'idle' && state !== 'sending' && (
        <p className="m-0 text-[12.5px] text-[#ff6b6b]">{state}</p>
      )}
    </form>
  );
}

/** The asset detail panel: a centred sheet on wide screens, a bottom sheet on phones. */
export function AssetDetail({
  asset,
  onClose,
  onStep,
}: {
  asset: Cc0Asset;
  onClose: () => void;
  onStep: (d: -1 | 1) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => back?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onStep(-1);
      if (e.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset, onClose, onStep]);

  const isUpload = asset.uploadId !== undefined;
  const download = isUpload ? `${asset.fileUrl}&dl=1` : asset.fileUrl;
  const size = formatBytes(asset.bytes);

  return createPortal(
    <div
      className="cc0-layer fixed inset-0 z-[9500] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={asset.title}
        className="cc0-sheet relative flex max-h-[92vh] w-full max-w-[920px] flex-col overflow-y-auto overflow-x-hidden rounded-t-[22px] bg-[#0f0f14] text-[#f4f2ea] shadow-[0_0_0_1px_rgba(255,255,255,.1),0_40px_90px_rgba(0,0,0,.7)] outline-none sm:flex-row sm:rounded-[22px]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-[#d4ff3a] hover:text-[#0b0b0f]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        <div className="cc0-check relative flex min-h-[240px] shrink-0 items-center justify-center sm:min-h-[420px] sm:w-[56%]">
          {asset.type === 'audio' ? (
            <div className="flex w-full flex-col items-center gap-4 p-6">
              <div className="w-40">
                <FileTile asset={asset} big />
              </div>
              <audio controls preload="none" src={asset.fileUrl} className="w-full max-w-[340px]">
                <track kind="captions" />
              </audio>
            </div>
          ) : asset.thumb !== undefined ? (
            <div className="w-full p-5 sm:p-8">
              <AssetImage
                key={asset.id}
                asset={asset}
                eager
                className="mx-auto max-h-[46vh] object-contain sm:max-h-[64vh]"
              />
            </div>
          ) : (
            <div className="w-48">
              <FileTile asset={asset} big />
            </div>
          )}
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button
              type="button"
              aria-label="Previous asset"
              onClick={() => onStep(-1)}
              className="grid h-9 w-9 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next asset"
              onClick={() => onStep(1)}
              className="grid h-9 w-9 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-white/20"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap gap-1.5 pr-10">
            <span className="cc0-mono rounded-md bg-[#d4ff3a] px-2 py-0.5 text-[10.5px] font-bold text-[#0b0b0f]">
              CC0 · PUBLIC DOMAIN
            </span>
            <span className="cc0-mono rounded-md bg-white/10 px-2 py-0.5 text-[10.5px] font-bold">
              {TYPE_LABEL[asset.type]}
            </span>
            <span
              className={`cc0-mono rounded-md px-2 py-0.5 text-[10.5px] font-bold ${isUpload ? 'bg-[#ff2f8e] text-white' : 'bg-white/10'}`}
            >
              {SOURCE_LABEL[asset.source]}
            </span>
          </div>
          <h2 className="m-0 break-words text-[24px] font-bold leading-tight text-white">
            {asset.title}
          </h2>
          <dl className="m-0">
            <Row k="CREATOR">
              {asset.creator}
              {asset.inMemoriam === true && (
                <span className="ml-1.5 text-[#9b998f]">· in memoriam</span>
              )}
            </Row>
            <Row k="SOURCE">
              {asset.sourceUrl !== undefined ? (
                <a
                  href={asset.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-[#20d6ff] hover:underline"
                >
                  {asset.sourceLabel}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                asset.sourceLabel
              )}
            </Row>
            <Row k="LICENSE">
              <a
                href={CC0_DEED}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#20d6ff] hover:underline"
              >
                CC0 1.0 Universal
              </a>
              <span className="text-[#9b998f]"> · no rights reserved, no credit needed</span>
            </Row>
            {(asset.ext !== undefined || size !== undefined) && (
              <Row k="FILE">{[asset.ext?.toUpperCase(), size].filter(Boolean).join(' · ')}</Row>
            )}
            {asset.description !== undefined && asset.description !== '' && (
              <Row k="NOTES">
                <span className="text-[#c9c7bd]">{asset.description}</span>
              </Row>
            )}
            {asset.tags.length > 0 && (
              <Row k="TAGS">
                <span className="flex flex-wrap gap-1">
                  {asset.tags.slice(0, 12).map(t => (
                    <span key={t} className="rounded-full bg-white/[.07] px-2 py-0.5 text-[11.5px]">
                      #{t}
                    </span>
                  ))}
                </span>
              </Row>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            <a
              href={download}
              target="_blank"
              rel="noopener noreferrer"
              {...(isUpload ? { download: '' } : {})}
              className="inline-flex items-center gap-2 rounded-full bg-[#d4ff3a] px-5 py-2.5 text-[14px] font-bold text-[#0b0b0f] no-underline shadow-[3px_3px_0_#ff2f8e] hover:bg-white"
            >
              {isUpload ? (
                <Download className="h-4 w-4" aria-hidden />
              ) : (
                <ExternalLink className="h-4 w-4" aria-hidden />
              )}
              {isUpload ? 'Download' : 'Open original'}
            </a>
            <button
              type="button"
              onClick={() => {
                const href = new URL(asset.fileUrl, window.location.href).href;
                void navigator.clipboard?.writeText(href).then(() => setCopied(asset.id));
              }}
              className="inline-flex items-center gap-2 rounded-full border-0 bg-white/10 px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-white/20"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              {copied === asset.id ? 'Copied' : 'Copy link'}
            </button>
          </div>
          {isUpload && <ReportBox key={asset.uploadId} id={asset.uploadId!} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

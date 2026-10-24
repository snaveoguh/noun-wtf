import { useEffect, useMemo, useRef, useState } from 'react';

import { UploadIcon as Upload, XIcon as X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { formatBytes } from './assets';
import { beginBody, submitAsset, type SubmitForm } from './submit';
import {
  ACCEPT,
  CONSENT_TEXT,
  CREATOR_MAX,
  fileTypeOf,
  MAX_FILE_BYTES,
  TITLE_MAX,
} from './uploadRules';

const EMPTY: SubmitForm = {
  title: '',
  creator: '',
  link: '',
  tags: '',
  consent: false,
  website: '',
};

const field = 'h-11 w-full px-3 text-[15px]';
const label = 'cc0-mono mb-1.5 block text-[10.5px] font-bold text-[#9b998f]';

/** SUBMIT A CC0 ASSET: file + details + the CC0 release box. Uploads land in the moderation queue. */
export function SubmitDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<SubmitForm>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const preview = useMemo(
    () =>
      file !== null && fileTypeOf(file.name)?.kind === 'image' ? URL.createObjectURL(file) : null,
    [file],
  );
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      back?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const set = (k: keyof SubmitForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: k === 'consent' ? e.target.checked : e.target.value }));

  const pick = (f: File | undefined) => {
    setError(null);
    if (f === undefined) return;
    if (fileTypeOf(f.name) === undefined) {
      setError(
        'that file type is not accepted (png, jpg, gif, webp, svg, mp3, wav, ogg, glb, gltf)',
      );
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError('files are capped at 10 MB');
      return;
    }
    setFile(f);
    if (form.title.trim() === '')
      setForm(v => ({
        ...v,
        title: f.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .slice(0, TITLE_MAX),
      }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (file === null) {
      setError('pick a file first');
      return;
    }
    const check = beginBody(form, file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(0);
    const r = await submitAsset(form, file, { onProgress: setBusy });
    setBusy(null);
    if (r.ok) setDone(true);
    else setError(r.error);
  };

  return createPortal(
    <div
      className="cc0-layer fixed inset-0 z-[9500] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={e => {
        if (e.target === e.currentTarget && busy === null) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc0-submit-title"
        data-cc0-submit
        className="cc0-sheet relative max-h-[94vh] w-full max-w-[560px] overflow-y-auto overflow-x-hidden rounded-t-[22px] bg-[#0f0f14] p-5 text-[#f4f2ea] shadow-[0_0_0_1px_rgba(255,255,255,.1),0_40px_90px_rgba(0,0,0,.7)] sm:rounded-[22px] sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-[#d4ff3a] hover:text-[#0b0b0f]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <span className="cc0-strap cc0-mono">OPEN CALL · CC0 ONLY</span>
        <h2
          id="cc0-submit-title"
          className="cc0-pip3 mb-1 mt-4 text-[34px] leading-none text-white"
          data-keep-font
        >
          Submit a <span className="text-[#d4ff3a]">CC0 asset</span>
        </h2>
        {done ? (
          <div className="mt-4 flex flex-col gap-4" data-cc0-done>
            <p className="m-0 text-[15px] leading-relaxed">
              Got it, thank you. It&apos;s in the review queue and shows up in the library, with an
              UPLOADED badge, once a moderator approves it.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDone(false);
                  setFile(null);
                  setForm(f => ({ ...EMPTY, creator: f.creator, link: f.link }));
                }}
                className="rounded-full border-0 bg-[#d4ff3a] px-5 py-2.5 text-[14px] font-bold text-[#0b0b0f]"
              >
                Send another
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border-0 bg-white/10 px-5 py-2.5 text-[14px] font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-3 flex flex-col gap-4" onSubmit={e => void submit(e)} noValidate>
            <p className="m-0 text-[14px] leading-relaxed text-[#c9c7bd]">
              Images, sounds or 3D models, up to 10 MB. Everything is reviewed before it goes up,
              and anyone can take it, forever.
            </p>
            <label
              onDragOver={e => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0]);
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed p-4 transition ${drag ? 'border-[#d4ff3a] bg-[#d4ff3a]/10' : 'border-white/20 hover:border-white/40'}`}
            >
              <input
                type="file"
                accept={ACCEPT}
                className="sr-only"
                data-cc0-file
                onChange={e => pick(e.target.files?.[0])}
              />
              <span className="cc0-check grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl">
                {preview !== null ? (
                  <img src={preview} alt="" className="h-full w-full object-contain" />
                ) : (
                  <Upload className="h-6 w-6 text-[#d4ff3a]" aria-hidden />
                )}
              </span>
              <span className="min-w-0 text-[14px]">
                {file !== null ? (
                  <>
                    <b className="block truncate">{file.name}</b>
                    <span className="text-[#9b998f]">{formatBytes(file.size)} · tap to change</span>
                  </>
                ) : (
                  <>
                    <b className="block">Choose a file or drop it here</b>
                    <span className="text-[12.5px] text-[#9b998f]">
                      png jpg gif webp svg · mp3 wav ogg · glb gltf
                    </span>
                  </>
                )}
              </span>
            </label>
            <div>
              <label className={label} htmlFor="cc0-title">
                TITLE
              </label>
              <input
                id="cc0-title"
                className={field}
                maxLength={TITLE_MAX}
                value={form.title}
                onChange={set('title')}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="cc0-creator">
                  CREATOR NAME / HANDLE
                </label>
                <input
                  id="cc0-creator"
                  className={field}
                  maxLength={CREATOR_MAX}
                  placeholder="@you"
                  value={form.creator}
                  onChange={set('creator')}
                />
              </div>
              <div>
                <label className={label} htmlFor="cc0-link">
                  LINK (OPTIONAL)
                </label>
                <input
                  id="cc0-link"
                  className={field}
                  inputMode="url"
                  placeholder="https://"
                  value={form.link}
                  onChange={set('link')}
                />
              </div>
            </div>
            <div>
              <label className={label} htmlFor="cc0-tags">
                TAGS
              </label>
              <input
                id="cc0-tags"
                className={field}
                placeholder="noggles, voxel, sfx"
                value={form.tags}
                onChange={set('tags')}
              />
            </div>
            {/* Honeypot: hidden from people, bots fill it */}
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="!absolute !left-[-9999px] !h-px !w-px"
              value={form.website}
              onChange={set('website')}
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#d4ff3a]/[.07] p-3.5 text-[14px] leading-snug shadow-[inset_0_0_0_1px_rgba(212,255,58,.3)]">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={set('consent')}
                data-cc0-consent
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#d4ff3a]"
              />
              <span>{CONSENT_TEXT}</span>
            </label>
            {error !== null && (
              <p role="alert" className="m-0 text-[13.5px] text-[#ff6b6b]">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy !== null || !form.consent}
              className="h-12 rounded-full border-0 bg-[#d4ff3a] text-[15px] font-bold text-[#0b0b0f] shadow-[3px_3px_0_#ff2f8e] transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy !== null ? `Uploading… ${Math.round(busy * 100)}%` : 'Submit for review'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

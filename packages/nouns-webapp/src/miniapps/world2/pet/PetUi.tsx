// ── CAMP pet HUD: the ADOPT prompt at the fridge, the card, the pet chip ──
//
// Prompt: CampUi's look (yellow, offset red shadow), E / tap. Card: the
// respect panel's glass. Chip: a util icon once adopted, opening the card
// (rename, how it follows, back to the fridge).

import type { FollowPref } from './contract';
import type { Game } from '../Game';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { IconButton } from '../hud/IconButton';
import { HudSlot } from '../hud/slots';

import { PET } from './contract';
import { cleanPetName, DEFAULT_PET_NAME } from './name';

const FOLLOW_LABEL: Record<FollowPref, [string, string]> = {
  auto: ['AUTO', 'runs beside you, flies when you skate fast'],
  beside: ['BESIDE', 'always runs beside you'],
  head: ['ON HEAD', 'rides on top of your head'],
  fly: ['FLYING', 'always flies by your shoulder'],
};

const CSS = `
.w2-pet-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;width:min(340px,calc(100vw - 32px));background:rgba(10,12,20,.9);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 14px 12px;font:12px system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45);text-align:left}
.w2-pet-card h3{margin:0;font:900 italic 24px system-ui,sans-serif;letter-spacing:.03em;color:#ffd400}
.w2-pet-card p{margin:2px 0 10px;opacity:.75;line-height:1.35}
.w2-pet-card label{display:block;font-size:10px;font-weight:900;letter-spacing:.14em;margin:10px 0 4px;opacity:.7}
.w2-pet-card input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px 10px;font:900 16px system-ui,sans-serif;letter-spacing:.06em;color:#fff;outline:none}
.w2-pet-card input:focus{border-color:#ffd400}
.w2-pet-opts{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.w2-pet-opt{border-radius:8px;padding:7px 8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#fff;text-align:left;font:800 11px system-ui,sans-serif;letter-spacing:.06em;cursor:pointer}
.w2-pet-opt small{display:block;font-weight:500;letter-spacing:0;opacity:.6;font-size:10px;margin-top:2px;line-height:1.2}
.w2-pet-opt[aria-pressed=true]{background:#ffd400;color:#000;border-color:#ffd400}
.w2-pet-go{margin-top:12px;width:100%;background:#ffd400;color:#000;font:900 italic 16px system-ui,sans-serif;padding:10px;border:0;cursor:pointer;box-shadow:5px 5px 0 #d22209}
.w2-pet-err{color:#ff6b8a;font-weight:700;margin-top:6px}
.w2-pet-row{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
body[data-pet-prompt] .mu-enter{display:none!important}
.w2-pet-small{background:none;border:0;color:#fff;opacity:.55;font:600 11px system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:4px 0}
`;

export function PetUi({ game, touch }: { game: Game; touch: boolean }) {
  const pet = game.pet;
  const view = useSyncExternalStore(pet.subscribe, () => pet.view);
  // ADOPT wins the top-centre spot (facing the fridge's wall would offer MURAL there too)
  const offered = view.prompt && view.card === null;
  useEffect(() => {
    document.body.toggleAttribute('data-pet-prompt', offered);
    return () => document.body.removeAttribute('data-pet-prompt');
  }, [offered]);
  return (
    <>
      <style>{CSS}</style>
      {view.prompt && view.card === null && (
        <div className="pointer-events-none absolute inset-0 z-30 select-none" data-pet="hud">
          <HudSlot name="toasts">
            <button
              type="button"
              data-pet="prompt"
              className="pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-center text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
              onClick={() => pet.openCard()}
            >
              ADOPT MOCHI — {touch ? 'TAP' : 'E'}
              <span className="block text-xs font-bold not-italic">the mouse on the fridge</span>
            </button>
          </HudSlot>
        </div>
      )}
      {view.adopted && view.card === null && (
        <HudSlot name="util">
          <IconButton
            icon="pet"
            label={`${view.name}: rename, or how it follows you`}
            onClick={() => pet.openCard()}
            data={{ 'data-pet': 'chip' }}
          />
        </HudSlot>
      )}
      {view.card !== null && <PetCard game={game} />}
    </>
  );
}

function PetCard({ game }: { game: Game }) {
  const pet = game.pet;
  const view = pet.view;
  const adopting = view.card === 'adopt';
  const [name, setName] = useState(view.adopted ? view.name : DEFAULT_PET_NAME);
  const [follow, setFollow] = useState<FollowPref>(view.follow);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const go = () => {
    const why = pet.commit(name, follow);
    if (why === 'empty') setErr('give it a name');
    else if (why === 'blocked') setErr('pick another name');
  };
  return (
    <div
      className="w2-pet-card"
      role="dialog"
      aria-label={adopting ? 'Adopt MOCHI' : `${view.name}`}
      data-pet="card"
      onKeyDown={e => {
        // typing stays in the card (not the game's keys)
        e.stopPropagation();
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') pet.closeCard();
      }}
    >
      <div className="w2-pet-row" style={{ marginTop: 0 }}>
        <h3>{adopting ? 'ADOPT MOCHI?' : view.name}</h3>
        <button
          type="button"
          className="w2-respect-x"
          aria-label="Close"
          onClick={() => pet.closeCard()}
        >
          ✕
        </button>
      </div>
      <p>
        {adopting
          ? 'A hairless flying mouse. Shy snack goblin: hides behind its ears, then steals your fries.'
          : 'Your mouse. It waits here every time you come back.'}
      </p>
      <label htmlFor="w2-pet-name">NAME</label>
      <input
        id="w2-pet-name"
        ref={input}
        value={name}
        maxLength={PET.nameMax}
        autoComplete="off"
        spellCheck={false}
        onChange={e => {
          setName(cleanPetName(e.target.value));
          setErr(null);
        }}
      />
      {err !== null && <div className="w2-pet-err">{err}</div>}
      <label>FOLLOWS YOU</label>
      <div className="w2-pet-opts">
        {(Object.keys(FOLLOW_LABEL) as FollowPref[]).map(f => (
          <button
            key={f}
            type="button"
            className="w2-pet-opt"
            aria-pressed={follow === f}
            data-pet-follow={f}
            onClick={() => setFollow(f)}
          >
            {FOLLOW_LABEL[f][0]}
            <small>{FOLLOW_LABEL[f][1]}</small>
          </button>
        ))}
      </div>
      <button type="button" className="w2-pet-go" data-pet="go" onClick={go}>
        {adopting ? 'ADOPT' : 'DONE'}
      </button>
      {!adopting && (
        <div className="w2-pet-row">
          <span style={{ opacity: 0.5 }}>saved in this browser</span>
          <button type="button" className="w2-pet-small" onClick={() => pet.release()}>
            back to the fridge
          </button>
        </div>
      )}
    </div>
  );
}

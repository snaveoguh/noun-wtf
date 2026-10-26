// ── Renaming the rider from inside the game (Settings → YOU) ───────────
//
// For players who skipped the name at the start. Same rules as the
// character select's field; the saved character keeps the new name, and
// multiplayer, the boards and chat pick it up from Game.name.

/** Same as the character select: 16 chars, A–Z 0–9 space . _ - */
export const NAME_MAX = 16;

export function cleanName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^\d .A-Z_-]/g, '')
    .slice(0, NAME_MAX);
}

/** The character select's storage (ui/CharacterSelect.tsx STORAGE_KEY). */
const STORAGE_KEY = 'noun-world-v2-character';

/** Set the rider's name and keep it with the saved character. Returns the name used. */
export function renameRider(game: { name: string }, raw: string): string | null {
  const name = cleanName(raw).trim();
  if (name === '') return null;
  game.name = name;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const c = JSON.parse(saved) as Record<string, unknown>;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...c, name }));
    }
  } catch {
    // storage blocked: the name lasts this visit
  }
  return name;
}

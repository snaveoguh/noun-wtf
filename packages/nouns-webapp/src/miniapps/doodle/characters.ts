/**
 * Doodle Garden characters. Built-in ones live in `public/doodle/`; drawings
 * added in the game (📷 button) are cut out in the browser and kept in this
 * browser's localStorage.
 *
 * To ship a new drawing for everyone: cut it out to a transparent webp in
 * `public/doodle/<id>.webp` and add a line to BUILT_IN.
 */

export interface DoodleCharacter {
  id: string;
  name: string;
  src: string;
  /** Added from a photo in this browser (can be deleted). */
  custom?: boolean;
}

export const BUILT_IN: DoodleCharacter[] = [
  { id: 'sunny', name: 'Sunny', src: '/doodle/sunny.webp' },
  { id: 'daisy', name: 'Daisy', src: '/doodle/daisy.webp' },
];

const KEY = 'doodle-garden-characters-v1';

export const loadCustom = (): DoodleCharacter[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as DoodleCharacter[]) : [];
    return Array.isArray(list) ? list.map(c => ({ ...c, custom: true })) : [];
  } catch {
    return [];
  }
};

/** Returns false if the browser refused to store it (full, private mode). */
export const saveCustom = (list: DoodleCharacter[]): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ id, name, src }) => ({ id, name, src }))));
    return true;
  } catch {
    return false;
  }
};

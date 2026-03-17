import { INounSeed } from '@/wrappers/nounToken';

export interface SavedDream {
  id: string;
  title: string;
  description: string;
  seed: INounSeed;
  createdAt: number;
  txHash?: string; // future: onchain payment receipt
}

export const DREAM_STORAGE_KEY = 'noun-wtf-dreams';
const MAX_DREAMS = 100;

export function loadDreams(): SavedDream[] {
  try {
    return JSON.parse(localStorage.getItem(DREAM_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveDreamToStorage(dream: SavedDream): void {
  const dreams = loadDreams();
  dreams.unshift(dream);
  localStorage.setItem(DREAM_STORAGE_KEY, JSON.stringify(dreams.slice(0, MAX_DREAMS)));
  // Notify other components in the same tab
  window.dispatchEvent(new Event('dreams-updated'));
}

export function deleteDream(id: string): void {
  const dreams = loadDreams().filter(d => d.id !== id);
  localStorage.setItem(DREAM_STORAGE_KEY, JSON.stringify(dreams));
  window.dispatchEvent(new Event('dreams-updated'));
}

export function generateDreamId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

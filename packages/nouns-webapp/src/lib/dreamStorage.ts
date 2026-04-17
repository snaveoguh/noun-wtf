import { INounSeed } from '@/wrappers/nounToken';

export type DreamStatus = 'draft' | 'published' | 'candidate' | 'proposed';
export type CustomTraitLayer = 'head' | 'body' | 'accessory' | 'glasses';

export interface SavedDream {
  id: string;
  title: string;
  description: string;
  seed: INounSeed;
  createdAt: number;
  txHash?: string;
  status: DreamStatus;
  candidateSlug?: string;
  proposalId?: number;
  customTraitData?: string;
  customTraitLayer?: CustomTraitLayer;
  customTraitPreview?: string;
}

export const DREAM_STORAGE_KEY = 'noun-wtf-dreams';
const MAX_DREAMS = 100;

export function loadDreams(): SavedDream[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DREAM_STORAGE_KEY) || '[]') as SavedDream[];
    return raw.map(d => ({ ...d, status: d.status ?? 'draft' }));
  } catch {
    return [];
  }
}

export function saveDreamToStorage(dream: SavedDream): void {
  const dreams = loadDreams();
  dreams.unshift(dream);
  localStorage.setItem(DREAM_STORAGE_KEY, JSON.stringify(dreams.slice(0, MAX_DREAMS)));
  window.dispatchEvent(new Event('dreams-updated'));
}

export function updateDream(id: string, updates: Partial<SavedDream>): void {
  const dreams = loadDreams().map(d => (d.id === id ? { ...d, ...updates } : d));
  localStorage.setItem(DREAM_STORAGE_KEY, JSON.stringify(dreams));
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

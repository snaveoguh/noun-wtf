import { INounSeed } from '@/wrappers/nounToken';

export type DreamStatus = 'draft' | 'candidate' | 'proposed';
export type CustomTraitLayer = 'head' | 'body' | 'accessory' | 'glasses';

export interface SavedDream {
  id: string;
  title: string;
  description: string;
  seed: INounSeed;
  createdAt: number;
  txHash?: string;
  /** Status in the dream lifecycle */
  status: DreamStatus;
  /** On-chain candidate slug (set when proposed) */
  candidateSlug?: string;
  /** On-chain proposal ID (set when promoted) */
  proposalId?: number;
  /** Custom uploaded trait — RLE hex data */
  customTraitData?: string;
  /** Which layer the custom trait replaces */
  customTraitLayer?: CustomTraitLayer;
  /** Data URI of the custom trait for preview */
  customTraitPreview?: string;
}

export const DREAM_STORAGE_KEY = 'noun-wtf-dreams';
const MAX_DREAMS = 100;

export function loadDreams(): SavedDream[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DREAM_STORAGE_KEY) || '[]') as SavedDream[];
    // Migrate old dreams without status field
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

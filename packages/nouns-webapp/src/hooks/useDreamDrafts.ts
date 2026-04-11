import { useCallback, useEffect, useState } from 'react';

import {
  type SavedDream,
  deleteDream,
  loadDreams,
  saveDreamToStorage,
  updateDream,
} from '@/lib/dreamStorage';

export function useDreamDrafts() {
  const [drafts, setDrafts] = useState<SavedDream[]>([]);

  const refresh = useCallback(() => {
    setDrafts(loadDreams());
  }, []);

  useEffect(() => {
    refresh();

    const handler = () => refresh();
    window.addEventListener('storage', handler);
    window.addEventListener('dreams-updated', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('dreams-updated', handler);
    };
  }, [refresh]);

  const saveDraft = useCallback(
    (dream: SavedDream) => {
      saveDreamToStorage(dream);
      refresh();
    },
    [refresh],
  );

  const removeDraft = useCallback(
    (id: string) => {
      deleteDream(id);
      refresh();
    },
    [refresh],
  );

  const editDraft = useCallback(
    (id: string, updates: Partial<SavedDream>) => {
      updateDream(id, updates);
      refresh();
    },
    [refresh],
  );

  return { drafts, saveDraft, removeDraft, editDraft };
}

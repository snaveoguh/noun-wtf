import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import MiniWindow from './MiniWindow';
import { useMiniWindows } from './store';

/**
 * Mounts every open MiniWindow into a single portal at document.body so the
 * floating chrome lives above whatever shell is active. Mount once, near the
 * App root.
 */
export default function MiniWindowHost() {
  const windows = useMiniWindows();
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setContainer(document.body);
  }, []);

  if (!container || windows.length === 0) return null;

  return createPortal(
    <>
      {windows.map(win => (
        <MiniWindow key={win.id} win={win} />
      ))}
    </>,
    container,
  );
}

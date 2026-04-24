import { useEffect } from 'react';

/**
 * Reference-counted global modal lock.
 *
 * Any modal/popup primitive should call useModalBodyLock(isOpen) while open
 * to:
 *   1. Set `data-modal-open="true"` on <body>, which CSS uses to hide the
 *      site NavBar + NocTicker strip (see src/index.css) so the site
 *      header/chrome doesn't bleed through on dark-background modals.
 *   2. Lock body scroll while a modal is up.
 *
 * The counter lets multiple modals stack (e.g. a confirm dialog on top of a
 * settings dialog) without one closing nuking the other's lock.
 */

let openCount = 0;
let previousOverflow = '';

const setBodyFlag = () => {
  if (openCount > 0) {
    if (!document.body.hasAttribute('data-modal-open')) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    document.body.setAttribute('data-modal-open', 'true');
  } else {
    document.body.removeAttribute('data-modal-open');
    document.body.style.overflow = previousOverflow;
  }
};

export const useModalBodyLock = (isOpen: boolean): void => {
  useEffect(() => {
    if (!isOpen) return;
    openCount += 1;
    setBodyFlag();
    return () => {
      openCount = Math.max(0, openCount - 1);
      setBodyFlag();
    };
  }, [isOpen]);
};

export default useModalBodyLock;

// Standalone entry for Noun Rush on its own domain (rush-app/index.html).
// Just the game: no NounOS shell, wallet or router. noun.wtf/rush keeps
// the in-OS version; both render the same RushPage.

import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';

import RushPage from '@/miniapps/rush/RushPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RushPage />
  </StrictMode>,
);

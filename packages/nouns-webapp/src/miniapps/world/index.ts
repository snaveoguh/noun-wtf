import React from 'react';

import type { Miniapp } from '../types';

const WorldIcon = React.createElement('span', null, '\u2694');

export const worldMiniapp: Miniapp = {
  name: 'Nouns World',
  slug: 'world',
  description: 'Multiplayer PvP fighting arena — battle as your Noun, wager ETH',
  icon: WorldIcon,
  routes: [
    {
      path: '/world',
      lazy: async () => {
        // WorldShell is the new entry; it currently re-exports WorldPage
        // while the full extraction is rolled out. Router contract stays
        // identical: default export is the page component.
        const { default: Component } = await import('./WorldShell');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'World',
      path: '/world',
      position: 'explore',
    },
  ],
};

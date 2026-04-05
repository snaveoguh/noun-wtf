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
        const { default: Component } = await import('./WorldPage');
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

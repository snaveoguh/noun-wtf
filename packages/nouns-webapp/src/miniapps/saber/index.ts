import React from 'react';

import type { Miniapp } from '../types';

const SaberIcon = React.createElement('span', null, '⚔️');

export const saberMiniapp: Miniapp = {
  name: 'Saber Arena',
  slug: 'saber',
  description: 'Lightsaber battle arena — fight Sith NPCs with your blue saber',
  icon: SaberIcon,
  routes: [
    {
      path: '/saber',
      lazy: async () => {
        const { default: Component } = await import('./SaberArenaPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Saber Arena',
      path: '/saber',
      position: 'explore',
    },
  ],
};

import React from 'react';

import type { Miniapp } from '../types';

export const crystalBallMiniapp: Miniapp = {
  name: 'Crystal Ball',
  slug: 'crystal-ball',
  description: 'Interactive 3D Noun prediction orb',
  icon: React.createElement('span', null, '\uD83D\uDD2E'),
  routes: [
    {
      path: '/crystal-ball',
      lazy: async () => {
        const { default: Component } = await import('./CrystalBallPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Crystal Ball',
      path: '/crystal-ball',
      position: 'explore',
    },
  ],
};

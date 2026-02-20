import React from 'react';

import type { Miniapp } from '../types';

const HighwayIcon = React.createElement('span', null, '🛣️');

export const highwayMiniapp: Miniapp = {
  name: 'Highway',
  slug: 'highway',
  description: 'ASCII art proposal highway — watch candidates scroll by',
  icon: HighwayIcon,
  routes: [
    {
      path: '/highway',
      lazy: async () => {
        const { default: Component } = await import('./HighwayPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Highway',
      path: '/highway',
      position: 'explore',
    },
  ],
};

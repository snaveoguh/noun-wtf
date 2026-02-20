import React from 'react';

import type { Miniapp } from '../types';

const FeedIcon = React.createElement('span', null, '📡');

export const feedMiniapp: Miniapp = {
  name: 'Feed',
  slug: 'feed',
  description: 'Onchain events + Farcaster /nouns channel',
  icon: FeedIcon,
  routes: [
    {
      path: '/feed',
      lazy: async () => {
        const { default: Component } = await import('./FeedPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Feed',
      path: '/feed',
      position: 'explore',
    },
  ],
};

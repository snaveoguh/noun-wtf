import React from 'react';

import type { Miniapp } from '../types';

const TerraformsIcon = React.createElement('span', null, '\u25A8');

export const terraformsMiniapp: Miniapp = {
  name: 'Terraforms',
  slug: 'terraforms',
  description: 'Mathcastles Terraforms onchain explorer',
  icon: TerraformsIcon,
  routes: [
    {
      path: '/terraforms',
      lazy: async () => {
        const { default: Component } = await import('./TerraformsPage');
        return { Component };
      },
    },
    {
      path: '/terraforms/:id',
      lazy: async () => {
        const { default: Component } = await import('./TerraformsPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Terraforms',
      path: '/terraforms',
      position: 'explore',
    },
  ],
};

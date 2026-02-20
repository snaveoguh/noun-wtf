import React from 'react';

import type { Miniapp } from '../types';

const TerminalIcon = React.createElement('span', null, '⌐◨-◨');

export const terminalMiniapp: Miniapp = {
  name: 'Terminal',
  slug: 'terminal',
  description: 'AI-powered Nouns navigator',
  icon: TerminalIcon,
  routes: [
    {
      path: '/terminal',
      lazy: async () => {
        const { default: Component } = await import('./TerminalPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Terminal',
      path: '/terminal',
      position: 'explore',
    },
  ],
};

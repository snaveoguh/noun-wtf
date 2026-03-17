import React from 'react';

import type { Miniapp } from '../types';

const CandidatesIcon = React.createElement('span', null, '📋');

export const candidatesMiniapp: Miniapp = {
  name: 'Candidates',
  slug: 'candidates',
  description: 'Proposal candidates — create, sponsor, and promote',
  icon: CandidatesIcon,
  routes: [
    {
      path: '/candidates',
      lazy: async () => {
        const { default: Component } = await import('./CandidatesPage');
        return { Component };
      },
    },
  ],
  navItems: [
    {
      label: 'Candidates',
      path: '/candidates',
      position: 'main',
    },
  ],
  enabled: true,
};

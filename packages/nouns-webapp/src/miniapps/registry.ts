import type { Miniapp } from './types';

/**
 * Miniapp Registry — discovers and manages all registered miniapps.
 * Each miniapp self-registers by calling registerMiniapp().
 * The hub (App.tsx, NavBar) reads from the registry to dynamically
 * add routes and nav items.
 */

const registry: Miniapp[] = [];

/** Register a miniapp with the hub */
export const registerMiniapp = (app: Miniapp): void => {
  // Prevent duplicate registration
  if (registry.some(a => a.slug === app.slug)) return;
  registry.push(app);
};

/** Get all registered miniapps */
export const getMiniapps = (): readonly Miniapp[] => registry;

/** Get a miniapp by slug */
export const getMiniapp = (slug: string): Miniapp | undefined =>
  registry.find(a => a.slug === slug);

/** Get all routes from all miniapps */
export const getMiniappRoutes = () =>
  registry.flatMap(app => app.routes);

/** Get all nav items from all miniapps */
export const getMiniappNavItems = () =>
  registry.flatMap(app => app.navItems);

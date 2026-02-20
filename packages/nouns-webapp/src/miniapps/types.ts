import type { RouteObject } from 'react-router';

/**
 * Miniapp interface — each feature module exports this shape.
 * Miniapps are composable: they work standalone AND inside the noun.wtf hub.
 */
export interface Miniapp {
  /** Display name */
  name: string;
  /** URL prefix, e.g. 'terminal' → /terminal */
  slug: string;
  /** Short description for tooltips/settings */
  description: string;
  /** Icon component for nav */
  icon: React.ReactNode;
  /** React Router route objects */
  routes: RouteObject[];
  /** Nav items to register in the hub's navbar */
  navItems: NavItem[];
  /** Optional: whether this miniapp is enabled by default */
  enabled?: boolean;
}

export interface NavItem {
  label: string;
  path: string;
  icon?: React.ReactNode;
  /** 'main' = top-level nav, 'explore' = inside Explore dropdown */
  position: 'main' | 'explore';
}

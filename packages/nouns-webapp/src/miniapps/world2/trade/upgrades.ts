// ── Noun Trade: van upgrades ─────────────────────────────────────────────

import type { VanUpgrade } from './contract';

export interface UpgradeSpec {
  id: VanUpgrade;
  name: string;
  cost: number;
  blurb: string;
}

export const UPGRADES: Record<VanUpgrade, UpgradeSpec> = {
  horn: { id: 'horn', name: 'Jingle horn', cost: 120, blurb: 'Street customers tip 5% more' },
  neon: { id: 'neon', name: 'Neon trim', cost: 200, blurb: 'Pure style. Glows at night' },
  freezer: { id: 'freezer', name: 'Deep freezer', cost: 300, blurb: 'Cargo spoils 4× slower' },
  bigbox: { id: 'bigbox', name: 'Big box', cost: 500, blurb: '+40 cargo slots' },
  engine: { id: 'engine', name: 'Hot engine', cost: 800, blurb: '+10% top speed' },
};

export const UPGRADE_IDS: VanUpgrade[] = ['horn', 'neon', 'freezer', 'bigbox', 'engine'];

export const isUpgrade = (v: unknown): v is VanUpgrade =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(UPGRADES, v);

/** Cargo slots of a stock van. */
export const BASE_CAPACITY = 40;
export const BIGBOX_SLOTS = 40;

export const capacityOf = (ups: readonly VanUpgrade[]) =>
  BASE_CAPACITY + (ups.includes('bigbox') ? BIGBOX_SLOTS : 0);

/** Spoil-rate multiplier (the freezer). */
export const spoilMultOf = (ups: readonly VanUpgrade[]) => (ups.includes('freezer') ? 0.25 : 1);

/** Top-speed multiplier (the engine); the server's travel check allows for it. */
export const speedMultOf = (ups: readonly VanUpgrade[]) => (ups.includes('engine') ? 1.1 : 1);

/** Street-sale price multiplier (the horn). */
export const serveMultOf = (ups: readonly VanUpgrade[]) => (ups.includes('horn') ? 1.05 : 1);

/**
 * Miniapp initializer — registers all miniapps with the hub.
 * Import this file once at app startup to register everything.
 */
import { feedMiniapp } from './feed';
import { highwayMiniapp } from './highway';
import { registerMiniapp } from './registry';
import { saberMiniapp } from './saber';
import { terminalMiniapp } from './terminal';

// Register all built-in miniapps
registerMiniapp(terminalMiniapp);
registerMiniapp(feedMiniapp);
registerMiniapp(highwayMiniapp);
registerMiniapp(saberMiniapp);

// Re-export for convenience
export { getMiniappNavItems, getMiniappRoutes, getMiniapps } from './registry';

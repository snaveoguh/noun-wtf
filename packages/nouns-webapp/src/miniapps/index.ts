/**
 * Miniapp initializer — registers all miniapps with the hub.
 * Import this file once at app startup to register everything.
 */
import { candidatesMiniapp } from './candidates';
import { crystalBallMiniapp } from './crystal-ball';
import { feedMiniapp } from './feed';
import { highwayMiniapp } from './highway';
import { registerMiniapp } from './registry';
import { saberMiniapp } from './saber';
import { terraformsMiniapp } from './terraforms';
import { terminalMiniapp } from './terminal';

// Register all built-in miniapps
registerMiniapp(terminalMiniapp);
registerMiniapp(crystalBallMiniapp);
registerMiniapp(feedMiniapp);
registerMiniapp(highwayMiniapp);
registerMiniapp(saberMiniapp);
registerMiniapp(candidatesMiniapp);
registerMiniapp(terraformsMiniapp);

// Re-export for convenience
export { getMiniappNavItems, getMiniappRoutes, getMiniapps } from './registry';

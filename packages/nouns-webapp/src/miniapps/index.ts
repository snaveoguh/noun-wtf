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
import { worldMiniapp } from './world';

// Register all built-in miniapps
// (terminal miniapp removed 2026-04-27 — merged into homepage TerminalFeed)
registerMiniapp(crystalBallMiniapp);
registerMiniapp(feedMiniapp);
registerMiniapp(highwayMiniapp);
registerMiniapp(saberMiniapp);
registerMiniapp(candidatesMiniapp);
registerMiniapp(terraformsMiniapp);
registerMiniapp(worldMiniapp);

// Re-export for convenience
export { getMiniappNavItems, getMiniappRoutes, getMiniapps } from './registry';

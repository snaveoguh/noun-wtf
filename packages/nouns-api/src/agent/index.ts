// ─── Agent NounIRL — Entry Point ────────────────────────────────────────────
//
// Starts the block watcher and exports all agent modules for use by the API.

import {
  startWatcher,
  stopWatcher,
  getWatcherState,
  checkNow,
  settleAuction,
} from './blockWatcher.js';
import { isBridgeConfigured } from './bridge.js';
import { generatePatch, applyAndDeploy, getDeployHistory, canDeploy } from './deployer.js';
import { DAO_FUNCTIONS, detectFunction, buildFunctionSkillPromptSnippet } from './functionSkill.js';
import {
  buildGovernanceContext,
  buildLiveAuctionContext,
  buildProposalsAndGrantsContext,
} from './governanceContext.js';
import { learnFromUrl, batchLearn, getKnowledgeStats, buildKnowledgeContext } from './knowledge.js';
import { NOUN_V2_KNOWLEDGE } from './nounV2Knowledge.js';
import { remember, recall, forget, recallAll, buildMemoryContext, countByScope } from './memory.js';
import {
  buildPeopleDb,
  getBuildStatus,
  listPeople,
  getPerson,
  searchPeople,
  getPeopleCount,
  buildPeopleContext,
  lookupPersonForChat,
} from './peopleDb.js';
import { reservationStore } from './reservations.js';
import {
  runSelfLearn,
  learnFromProposals,
  learnFromAuctions,
  learnFromDelegates,
} from './selfLearn.js';
import { verifyTip, getAgentBalance } from './tipVerifier.js';
import {
  predictSeed,
  seedToTraitNames,
  matchesTraits,
  parseTraitDescription,
  getAllTraitNames,
} from './traitPredictor.js';

// ─── Auto-start on import ──────────────────────────────────────────────────

let started = false;

export function initAgent(): void {
  if (started) return;
  started = true;

  // Only start the block watcher if the agent wallet is configured
  if (process.env.NOUNIRL_ADDRESS) {
    console.log('[NounIRL] ⌐◨-◨ Agent NounIRL initializing...');
    startWatcher();
  } else {
    console.log('[NounIRL] NOUNIRL_ADDRESS not set — agent running in API-only mode');
  }
}

// ─── Re-exports ────────────────────────────────────────────────────────────

export {
  // Block watcher
  startWatcher,
  stopWatcher,
  getWatcherState,
  checkNow,
  settleAuction,

  // Reservations
  reservationStore,

  // Tip verification
  verifyTip,
  getAgentBalance,

  // Trait prediction
  predictSeed,
  seedToTraitNames,
  matchesTraits,
  parseTraitDescription,
  getAllTraitNames,

  // Deployer
  generatePatch,
  applyAndDeploy,
  getDeployHistory,
  canDeploy,

  // Bridge
  isBridgeConfigured,

  // Memory
  remember,
  recall,
  forget,
  recallAll,
  buildMemoryContext,
  countByScope,

  // Knowledge ingestion
  learnFromUrl,
  batchLearn,
  getKnowledgeStats,
  buildKnowledgeContext,

  // NounV2 static knowledge block
  NOUN_V2_KNOWLEDGE,

  // Self-learning from noun.wtf
  runSelfLearn,
  learnFromProposals,
  learnFromAuctions,
  learnFromDelegates,

  // Governance context (per-wallet profile + live auction + global overview for chat)
  buildGovernanceContext,
  buildLiveAuctionContext,
  buildProposalsAndGrantsContext,

  // Function skill (natural-language → DAO function intent detection)
  DAO_FUNCTIONS,
  detectFunction,
  buildFunctionSkillPromptSnippet,

  // People database
  buildPeopleDb,
  getBuildStatus,
  listPeople,
  getPerson,
  searchPeople,
  getPeopleCount,
  buildPeopleContext,
  lookupPersonForChat,
};

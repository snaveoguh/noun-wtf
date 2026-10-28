/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessGasBudget,
  LOW_ALERT_REPEAT_MS,
  nextAlert,
  SETTLEMENT_GAS_KNOWLEDGE,
  settlesCovered,
} from './settleBudget.js';

// The chat's case (2026-10-28): 0.0034 ETH, preflight at the 6 gwei floor
// (500k × 6 gwei = 0.003 ETH), a settle ~350k × 5.05 gwei ≈ 0.00177 ETH.
const CHAT = { balanceEth: 0.0034, preflightEth: 0.003, settleCostEth: 0.00177 };

describe('settlesCovered', () => {
  it('needs the preflight for every settle, not just the first', () => {
    assert.equal(settlesCovered(0.0034, 0.003, 0.00177), 1);
    assert.equal(settlesCovered(0.003 + 0.00177, 0.003, 0.00177), 2);
    assert.equal(settlesCovered(0.01, 0.003, 0.001), 8);
  });

  it('is zero below the preflight', () => {
    assert.equal(settlesCovered(0.0029, 0.003, 0.0001), 0);
    assert.equal(settlesCovered(0, 0.003, 0.001), 0);
  });
});

describe('assessGasBudget', () => {
  it('flags the chat case: one settle, then nothing until a top-up', () => {
    const b = assessGasBudget({ ...CHAT, pendingReservations: 1, standingTargets: 1 });
    assert.equal(b.settlesCovered, 1);
    assert.equal(b.canSettleNow, true);
    assert.equal(b.short, false);
    assert.equal(b.low, true);
    assert.match(b.summary, /covers 1 settle /);
    assert.match(b.summary, /1 standing target/);
    assert.match(b.summary, /top-up/);
  });

  it('is short when more reservations wait than it can settle', () => {
    const b = assessGasBudget({ ...CHAT, pendingReservations: 3, standingTargets: 0 });
    assert.equal(b.short, true);
    // Three settles need 0.003 + 2 × 0.00177 = 0.00654 ETH.
    assert.equal(b.topUpEth, 0.00314);
    assert.match(b.summary, /about 0\.00314 ETH more/);
  });

  it('says it cannot settle at all below the preflight', () => {
    const b = assessGasBudget({
      ...CHAT,
      balanceEth: 0.001,
      pendingReservations: 0,
      standingTargets: 1,
    });
    assert.equal(b.canSettleNow, false);
    assert.equal(b.low, true);
    assert.match(b.summary, /cannot settle anything/);
  });

  it('is fine with headroom', () => {
    const b = assessGasBudget({
      ...CHAT,
      balanceEth: 0.05,
      pendingReservations: 2,
      standingTargets: 1,
    });
    assert.equal(b.short, false);
    assert.equal(b.low, false);
    assert.equal(b.topUpEth, 0);
  });
});

describe('nextAlert', () => {
  const t0 = 1_800_000_000_000;

  it('alerts on turning low, then waits out the repeat window', () => {
    let s = { lastAlertAt: 0 };
    let step = nextAlert(s, true, t0);
    assert.equal(step.alert, true);
    s = step.state;
    step = nextAlert(s, true, t0 + 60_000);
    assert.equal(step.alert, false);
    step = nextAlert(s, true, t0 + LOW_ALERT_REPEAT_MS);
    assert.equal(step.alert, true);
  });

  it('re-arms after recovering', () => {
    let s = nextAlert({ lastAlertAt: 0 }, true, t0).state;
    s = nextAlert(s, false, t0 + 1000).state;
    assert.equal(nextAlert(s, true, t0 + 2000).alert, true);
  });

  it('never alerts while healthy', () => {
    assert.equal(nextAlert({ lastAlertAt: 0 }, false, t0).alert, false);
  });
});

describe('SETTLEMENT_GAS_KNOWLEDGE', () => {
  it('tells the agent the risk without promising what the code does not do', () => {
    assert.match(SETTLEMENT_GAS_KNOWLEDGE, /Nothing is ring-fenced per reservation/);
    assert.match(SETTLEMENT_GAS_KNOWLEDGE, /not a queue/);
    assert.match(SETTLEMENT_GAS_KNOWLEDGE, /no automatic refund/);
    assert.match(SETTLEMENT_GAS_KNOWLEDGE, /get_agent_balance/);
  });
});

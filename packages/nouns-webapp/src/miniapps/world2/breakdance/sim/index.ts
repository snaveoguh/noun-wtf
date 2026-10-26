// breakdance/sim: the battle itself (pure TypeScript, deterministic, no three.js / DOM / clock).

export { BreakBattle, createBattleSim, LATE_SLACK } from './BattleSim';
export { beatAt, buildSchedule, INTRO_BEATS, roundOrder, timeOf } from './clock';
export { canFlow, MOVE_LIST, MOVES } from './moves';
export { planTurn, type PlannedMove } from './planner';
export { JUDGES } from './scoring';
export { cpuConfig, inputsFor, runBattle } from './harness';

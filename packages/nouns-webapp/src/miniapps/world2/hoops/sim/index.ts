// hoops/sim: the game itself (pure TypeScript, deterministic, no three.js / DOM).

export { HoopsSim, HOOPS, clonePlain } from './HoopsSim';
export { attackRim, makeGeo, type CourtGeo } from './court';
export { botConfig, botRoster, formatBoxScore, runBotGame } from './harness';

// ── Nouns World Engine — Platform-agnostic game logic ────────────────
//
// Shared between web (nouns-webapp) and native (nouns-world-visionos).
// No DOM, Canvas, WebRTC, or Web Audio dependencies.

// Core types & constants
export * from './engine/types';

// Physics & math
export * from './engine/physics';

// Input (pure state, no DOM listeners)
export * from './engine/input';

// Combat system
export * from './engine/combat';
export * from './engine/moves';
export * from './engine/combo';
export * from './engine/weapons';
export * from './engine/sword';

// World
export * from './engine/tilemap';
export * from './engine/camera';

// Game systems
export * from './engine/skating';
export * from './engine/npcs';
export * from './engine/drops';
export * from './engine/particles';
export * from './engine/ocean';
export * from './engine/daynight';
export * from './engine/graffiti';
export * from './engine/settlement';
export * from './engine/spatialPassword';

// Multiplayer
export * from './multiplayer/protocol';
export * from './multiplayer/client';

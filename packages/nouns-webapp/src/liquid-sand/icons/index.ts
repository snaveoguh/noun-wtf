/**
 * Liquid Sand monoline icon library.
 *
 * All icons share the same look:
 * - 24x24 viewBox
 * - fill="none", stroke="currentColor", strokeWidth="1.75"
 * - rounded line caps + joins
 * - default `size="1em"` so they scale to the surrounding font-size
 *
 * Color is controlled via CSS `color` because every stroke uses `currentColor`.
 * That's what enables the parallel background-aware inversion work to invert
 * icons over different glass tints without needing per-icon variants.
 *
 * Usage:
 *   import { Folder, Settings } from '@/liquid-sand/icons';
 *   <Folder className="text-white/80" size={20} />
 */

export type { IconProps } from './types';

// System
export { Power } from './Power';
export { Lock } from './Lock';
export { Settings } from './Settings';
export { Shutdown } from './Shutdown';
export { Restart } from './Restart';
export { Sleep } from './Sleep';
export { Boot } from './Boot';
export { Eject } from './Eject';

// Files & Finder
export { Folder } from './Folder';
export { FolderOpen } from './FolderOpen';
export { Document } from './Document';
export { DocumentText } from './DocumentText';
export { DocumentImage } from './DocumentImage';
export { DocumentMusic } from './DocumentMusic';
export { DocumentVideo } from './DocumentVideo';
export { FileGeneric } from './FileGeneric';

// Window controls
export { Close } from './Close';
export { Minimize } from './Minimize';
export { Maximize } from './Maximize';

// Apps
export { Joystick } from './Joystick';
export { Calculator } from './Calculator';
export { Clock } from './Clock';
export { Calendar } from './Calendar';
export { StickyNote } from './StickyNote';
export { Brush } from './Brush';
export { Bell } from './Bell';
export { Key } from './Key';
export { CpuChip } from './CpuChip';
export { Console } from './Console';

// Communication
export { ChatBubble } from './ChatBubble';
export { Mail } from './Mail';
export { MagnifyingGlass } from './MagnifyingGlass';
export { Megaphone } from './Megaphone';

// Status & menu bar
export { Wifi } from './Wifi';
export { Battery } from './Battery';
export { BatteryLow } from './BatteryLow';
export { BatteryCharging } from './BatteryCharging';
export { VolumeHigh } from './VolumeHigh';
export { VolumeMuted } from './VolumeMuted';

// Wallet / Web3
export { Wallet } from './Wallet';
export { Coin } from './Coin';
export { Diamond } from './Diamond';

// Misc
export { Sparkle } from './Sparkle';
export { Heart } from './Heart';
export { Star } from './Star';
export { Sandglass } from './Sandglass';
export { Clipboard } from './Clipboard';
export { Info } from './Info';
export { Globe } from './Globe';
export { Trash } from './Trash';

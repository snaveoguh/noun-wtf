/**
 * Liquid Sand UI — background-aware color inversion.
 *
 * See ./README.md for guidance on which approach to pick.
 */

export {
  BlendIcon,
  BLEND_CLASSES,
  blendStyle,
  tailwindPluginConfig,
  type BlendIconProps,
  type BlendMode,
} from './blendMode';

export {
  useBackgroundLuminance,
  sampleBackgroundLuminance,
  rgbToLuminance,
  bucketize,
  type LuminanceBucket,
  type LuminanceSample,
  type UseBackgroundLuminanceOptions,
} from './sampleLuminance';

export { AdaptiveColor, type AdaptiveColorProps } from './AdaptiveColor';

export {
  registerHoudiniWorklet,
  HOUDINI_PAINT_NAME,
  type HoudiniRegistration,
} from './houdiniWorklet';

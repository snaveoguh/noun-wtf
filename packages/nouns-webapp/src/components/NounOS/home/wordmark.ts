// The noun.wtf wordmark's lettering, shared by the homescreen header
// (homeStyles.ts .nh-wordmark) and Noun World's loader (world2/ui/WorldLoader.tsx)
// so the two match exactly: dark grey Pip3 capitals, and a light band that
// sweeps across them once (the shimmer).

export const WORDMARK_TEXT = 'NOUN.WTF';
export const WORDMARK_FONT = "'Pip3','Londrina Solid',system-ui,sans-serif";
export const WORDMARK_INK = '#34343b';
export const WORDMARK_BAND = '#d9d9e0';
/** Background for background-clip:text; position 100% 0 = band off the right, 0 0 = swept past. */
export const WORDMARK_SHIMMER = `linear-gradient(100deg,${WORDMARK_INK} 0 40%,${WORDMARK_BAND} 50%,${WORDMARK_INK} 60% 100%)`;
export const WORDMARK_SHIMMER_SIZE = '250% 100%';
export const WORDMARK_TRACKING = '.06em';

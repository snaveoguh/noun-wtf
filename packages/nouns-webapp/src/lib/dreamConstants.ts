export const DREAM_SLUG_PREFIX = 'nounwtf-dream-';

export function buildDreamSlug(dreamId: string): string {
  return `${DREAM_SLUG_PREFIX}${dreamId}`;
}

export function isDreamCandidate(slug: string): boolean {
  return slug.startsWith(DREAM_SLUG_PREFIX);
}

export function extractDreamId(slug: string): string | null {
  if (!isDreamCandidate(slug)) return null;
  return slug.slice(DREAM_SLUG_PREFIX.length);
}

/** Marker format for embedding artwork in candidate descriptions */
export const ARTWORK_MARKER_PREFIX = '[artwork:';
export const ARTWORK_MARKER_SUFFIX = ']';

export function embedArtworkInDescription(description: string, svgDataUri: string): string {
  return `${ARTWORK_MARKER_PREFIX}${svgDataUri}${ARTWORK_MARKER_SUFFIX}\n\n${description}`;
}

export function extractArtworkFromDescription(description: string): {
  artwork: string | null;
  cleanDescription: string;
} {
  const markerStart = description.indexOf(ARTWORK_MARKER_PREFIX);
  if (markerStart === -1) return { artwork: null, cleanDescription: description };

  const dataStart = markerStart + ARTWORK_MARKER_PREFIX.length;
  const markerEnd = description.indexOf(ARTWORK_MARKER_SUFFIX, dataStart);
  if (markerEnd === -1) return { artwork: null, cleanDescription: description };

  const artwork = description.slice(dataStart, markerEnd);
  const cleanDescription = (
    description.slice(0, markerStart) + description.slice(markerEnd + ARTWORK_MARKER_SUFFIX.length)
  ).trim();

  return { artwork, cleanDescription };
}

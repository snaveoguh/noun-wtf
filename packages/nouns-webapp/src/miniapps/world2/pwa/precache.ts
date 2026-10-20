// What the Noun World service worker precaches at install: the site's entry
// chunk(s) and the lazily loaded World2Page chunk with everything it imports
// statically (JS + CSS). Pure, so the Vite plugin and tests share it.

/** The bits of a Rollup output chunk / asset we read. */
export interface BundleItem {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
}

export const WORLD_ENTRY = /src\/miniapps\/world2\/World2Page\.tsx$/;

export function worldPrecache(bundle: Record<string, BundleItem>): string[] {
  const out = new Set<string>();
  const walk = (file: string) => {
    if (out.has(`/${file}`)) return;
    const it = bundle[file];
    if (it === undefined) return;
    out.add(`/${file}`);
    if (it.type !== 'chunk') return;
    for (const css of it.viteMetadata?.importedCss ?? []) out.add(`/${css}`);
    for (const dep of it.imports ?? []) walk(dep);
  };
  for (const it of Object.values(bundle)) {
    if (it.type !== 'chunk') continue;
    if (it.isEntry === true || WORLD_ENTRY.test(it.facadeModuleId ?? '')) walk(it.fileName);
  }
  return [...out].sort();
}

/** A short id for this build (changes whenever any precached file name does). */
export function buildId(files: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of files.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

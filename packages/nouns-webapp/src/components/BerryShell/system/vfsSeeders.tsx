/**
 * Reactive seeders that keep the VFS in sync with live data.
 *
 * Mounted once near the top of the BerryShell tree (or from any always-
 * mounted app shell). Each seeder is its own hook so they can be added /
 * removed independently as new data sources come online.
 *
 * Source-of-truth strategy:
 * - `/Applications/`         ← static `APP_REGISTRY` (forward-compatible to
 *                              the future `berryRegistry.list()` call when
 *                              the registry agent ships it).
 * - `/Documents/Nouns/`      ← unique noun IDs harvested from the recent
 *                              activity feed.
 * - `/Documents/Proposals/`  ← `useAllProposals()` snapshot, one .prop file
 *                              per proposal, content = description markdown.
 *
 * All seeded files are tagged `metadata.synthesized = true` so the
 * `vfs.replaceSynthesized()` helper can refresh them without disturbing
 * anything the user has dropped in those folders.
 */

import { useEffect } from 'react';

import { useActivityFeed } from '@/components/TerminalFeed/useActivityFeed';
import { useAllProposals } from '@/wrappers/nounsDao';

import { APP_REGISTRY } from '../apps/registry';
import { berryBus } from './eventBus';
import { vfs, type BerryFile } from './vfs';

function appsToFiles(): BerryFile[] {
  const now = Date.now();
  return Object.values(APP_REGISTRY).map<BerryFile>(def => ({
    path: `/Applications/${def.title}.app`,
    name: `${def.title}.app`,
    type: 'file',
    mimeType: 'application/x-berry-app',
    icon: def.emoji,
    createdAt: now,
    modifiedAt: now,
    metadata: {
      appId: def.appId,
      width: def.width,
      height: def.height,
    },
  }));
}

/** Mount once — keeps `/Applications/` mirrored to the registry. */
export function useApplicationsSeeder(): void {
  useEffect(() => {
    vfs.replaceSynthesized('/Applications', appsToFiles());
  }, []);
}

/** Mount once — keeps `/Documents/Nouns/` mirrored to recent feed activity. */
export function useNounsFolderSeeder(): void {
  const { events } = useActivityFeed('');
  useEffect(() => {
    if (!events || events.length === 0) return;
    const seen = new Set<string>();
    const files: BerryFile[] = [];
    for (const ev of events) {
      const ne = ev as { nounId?: string | number | bigint };
      const nounId = ne.nounId;
      if (nounId === undefined || nounId === null) continue;
      const key = String(nounId);
      if (seen.has(key)) continue;
      seen.add(key);
      const now = Date.now();
      files.push({
        path: `/Documents/Nouns/Noun ${key}.noun`,
        name: `Noun ${key}.noun`,
        type: 'file',
        mimeType: 'application/x-noun',
        icon: '🟪',
        createdAt: now,
        modifiedAt: now,
        metadata: { nounId: key, source: 'activity-feed' },
      });
      if (files.length >= 32) break;
    }
    if (files.length === 0) return;
    vfs.replaceSynthesized('/Documents/Nouns', files);
  }, [events]);
}

/** Mount once — keeps `/Documents/Proposals/` mirrored to active proposals. */
export function useProposalsFolderSeeder(): void {
  const { data: proposals } = useAllProposals();
  useEffect(() => {
    if (!proposals || proposals.length === 0) return;
    const files: BerryFile[] = proposals.slice(0, 50).map(p => {
      const id = String(p.id ?? '?');
      const safeTitle = (p.title ?? `Proposal ${id}`)
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 80);
      const name = `${id} — ${safeTitle}.prop`;
      const description =
        typeof (p as { description?: string }).description === 'string'
          ? (p as { description?: string }).description!
          : `# ${safeTitle}\n\nProposal ${id}`;
      const now = Date.now();
      return {
        path: `/Documents/Proposals/${name}`,
        name,
        type: 'file',
        mimeType: 'text/markdown',
        icon: '🗳️',
        size: description.length,
        content: description,
        createdAt: now,
        modifiedAt: now,
        metadata: {
          proposalId: id,
          status: p.status,
          source: 'subgraph',
        },
      } satisfies BerryFile;
    });
    vfs.replaceSynthesized('/Documents/Proposals', files);
  }, [proposals]);
}

/**
 * Convenience wrapper — mounts every seeder + emits a single
 * `system:bootComplete`-style log when first run.
 */
export function VfsSeeders() {
  useApplicationsSeeder();
  useNounsFolderSeeder();
  useProposalsFolderSeeder();
  useEffect(() => {
    berryBus.emit('fs:created', {
      file: vfs.read('/') ?? {
        path: '/',
        name: '/',
        type: 'folder',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
    });
  }, []);
  return null;
}

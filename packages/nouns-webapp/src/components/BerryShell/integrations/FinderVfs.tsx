/**
 * FinderVfs — VFS-backed Finder rewrite.
 *
 * Drop-in replacement for `apps/FinderApp.tsx` that:
 *   - browses the BerryOS virtual filesystem starting at `/`,
 *   - shows folders + files with their icons + sizes,
 *   - double-click on a folder navigates in,
 *   - double-click on an `application/x-berry-app` emits `app:launching`,
 *   - every file is a `useDraggable` source so Noun files (and anything
 *     else) can be dragged out into other apps.
 *
 * To swap this in for the existing registry entry, see the integration
 * patch documented in `BerryShell/integrations/README` (or simply update
 * `apps/registry.tsx`'s `finder.Component` to `FinderVfs`).
 */

import { useMemo, useState, type CSSProperties } from 'react';

import { useDraggable, type BerryDragPayload, type BerryDragType } from '../system/dnd';
import { berryBus } from '../system/eventBus';
import {
  dirname,
  joinPath,
  useVfsListing,
  vfs,
  type BerryFile,
} from '../system/vfs';

interface FinderRowProps {
  file: BerryFile;
  onOpen: (file: BerryFile) => void;
}

const FILE_KIND_ICON: Record<string, string> = {
  'application/x-berry-app': '🟦',
  'application/x-noun': '🟪',
  'text/markdown': '📝',
};

function fileToDragPayload(file: BerryFile): BerryDragPayload {
  let type: BerryDragType = 'file';
  let data: unknown = file;
  if (file.mimeType === 'application/x-noun') {
    type = 'noun';
    data = {
      nounId: file.metadata?.nounId,
      name: file.name,
      path: file.path,
    };
  } else if (file.mimeType === 'application/x-berry-app') {
    type = 'app';
    data = { appId: file.metadata?.appId, name: file.name };
  }
  return {
    type,
    data,
    sourceAppId: 'finder',
    mimeHint: file.mimeType,
  };
}

function FinderRow({ file, onOpen }: FinderRowProps) {
  const { bind, isDragging } = useDraggable(() => fileToDragPayload(file));

  const icon =
    file.icon ??
    (file.type === 'folder' ? '📁' : (file.mimeType && FILE_KIND_ICON[file.mimeType]) || '📄');

  return (
    <li
      {...bind}
      onDoubleClick={() => onOpen(file)}
      onKeyDown={e => {
        if (e.key === 'Enter') onOpen(file);
      }}
      role="button"
      tabIndex={0}
      aria-label={file.name}
      style={{
        ...bind.style,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderBottom: '1px dotted var(--theme-feed-row-border)',
        opacity: isDragging ? 0.55 : 1,
        background: 'transparent',
      }}
    >
      <span style={{ fontSize: 16, width: 22, textAlign: 'center' }} aria-hidden="true">
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--theme-font-body)',
          fontSize: 13,
          color: 'var(--theme-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {file.name}
      </span>
      {file.type === 'file' && file.size !== undefined && (
        <span
          style={{
            fontFamily: 'var(--theme-font-display)',
            fontSize: 10,
            color: 'var(--theme-text-muted)',
            minWidth: 60,
            textAlign: 'right',
          }}
        >
          {file.size.toLocaleString()} B
        </span>
      )}
    </li>
  );
}

const breadcrumbStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  background: 'var(--theme-bg-tertiary)',
  borderBottom: '1px solid var(--theme-border)',
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  color: 'var(--theme-text-muted)',
};

const SIDEBAR_LINKS: Array<{ label: string; path: string; icon: string }> = [
  { label: 'Applications', path: '/Applications', icon: '🟦' },
  { label: 'Desktop', path: '/Desktop', icon: '🖥️' },
  { label: 'Documents', path: '/Documents', icon: '📁' },
  { label: 'Nouns', path: '/Documents/Nouns', icon: '🟪' },
  { label: 'Proposals', path: '/Documents/Proposals', icon: '🗳️' },
  { label: 'Trash', path: '/Trash', icon: '🗑️' },
];

export default function FinderVfs() {
  const [cwd, setCwd] = useState<string>('/');
  const listing = useVfsListing(cwd);

  const breadcrumbs = useMemo(() => {
    if (cwd === '/') return [{ label: '/', path: '/' }];
    const parts = cwd.split('/').filter(Boolean);
    const out = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      out.push({ label: p, path: acc });
    }
    return out;
  }, [cwd]);

  const handleOpen = (file: BerryFile) => {
    if (file.type === 'folder') {
      setCwd(file.path);
      return;
    }
    if (file.mimeType === 'application/x-berry-app') {
      const appId = file.metadata?.appId;
      if (typeof appId === 'string') {
        berryBus.emit('app:launching', { appId, source: 'finder' });
      }
    }
    // For non-app files, double-click is a no-op for now — drag is the
    // primary interaction. (A future "Quick Look" preview could land here.)
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: 'var(--theme-font-display)',
      }}
    >
      <aside
        style={{
          width: 130,
          background: 'var(--theme-bg-secondary)',
          borderRight: '1px solid var(--theme-border)',
          padding: '8px 4px',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            ...breadcrumbStyle,
            background: 'transparent',
            border: 'none',
            padding: '4px 8px',
            fontSize: 9,
            color: 'var(--theme-text-muted)',
          }}
        >
          PLACES
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {SIDEBAR_LINKS.map(link => {
            const active = cwd === link.path;
            return (
              <li key={link.path}>
                <button
                  type="button"
                  onClick={() => setCwd(link.path)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    border: 'none',
                    background: active ? 'var(--theme-accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--theme-text-primary)',
                    fontFamily: 'var(--theme-font-display)',
                    fontSize: 12,
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 16 }}>
                    {link.icon}
                  </span>
                  {link.label}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <nav style={breadcrumbStyle} aria-label="path">
          {breadcrumbs.map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span aria-hidden="true">/</span>}
              <button
                type="button"
                onClick={() => setCwd(c.path)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color:
                    i === breadcrumbs.length - 1
                      ? 'var(--theme-text-primary)'
                      : 'var(--theme-text-muted)',
                  fontFamily: 'var(--theme-font-display)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          {cwd !== '/' && (
            <button
              type="button"
              onClick={() => setCwd(dirname(cwd))}
              style={{
                background: 'transparent',
                border: '1px solid var(--theme-border)',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--theme-text-secondary)',
              }}
              aria-label="Up one folder"
            >
              ▲ Up
            </button>
          )}
          {cwd === '/Trash' && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Empty trash permanently?')) vfs.emptyTrash();
              }}
              style={{
                background: 'var(--theme-bg-primary)',
                border: '1px solid var(--theme-border)',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--theme-text-secondary)',
              }}
            >
              Empty
            </button>
          )}
        </nav>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {listing.length === 0 ? (
            <div
              style={{
                padding: 24,
                color: 'var(--theme-text-muted)',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {cwd === '/Desktop'
                ? 'Desktop is empty. Drop files here.'
                : 'Empty folder.'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {listing.map(file => (
                <FinderRow
                  key={file.path}
                  file={file}
                  onOpen={handleOpen}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export path helper for convenience.
export { joinPath };

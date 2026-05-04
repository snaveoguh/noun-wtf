import { useState, type ReactNode } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

export interface SectionItem {
  key: string;
  /** Section heading. */
  title: string;
  /** Optional sub-heading shown beneath the title in muted text. */
  description?: string;
  /** Rendered list rows — typically <ProposalListItem /> or <CandidateListItem />. */
  children: ReactNode;
  /** Collapsed by default? Camp keeps everything expanded; we mirror that. */
  collapsedByDefault?: boolean;
  /** Hide rows beyond this index until the user clicks "Show more". */
  truncationThreshold?: number;
  /** Number of items in the section (used for the count badge). */
  count?: number;
}

interface SectionedListProps {
  sections: SectionItem[];
  emptyState?: ReactNode;
}

/**
 * Lightweight reimplementation of `apps/nouns-camp/src/components/sectioned-list.jsx`.
 * Camp's SectionedList is ~1500 LOC because it knows how to render proposals,
 * candidates, drafts, and accounts uniformly — we keep it dumb and let the
 * caller pass already-rendered <li> children.
 */
export default function SectionedList({ sections, emptyState }: SectionedListProps) {
  if (sections.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        {emptyState ?? 'Nothing here yet.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {sections.map(section => (
        <Section key={section.key} section={section} />
      ))}
    </div>
  );
}

function Section({ section }: { section: SectionItem }) {
  const [collapsed, setCollapsed] = useState(section.collapsedByDefault ?? false);

  return (
    <section style={{ borderBottom: '1px solid var(--theme-border)' }}>
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--theme-text-primary)',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        {collapsed ? (
          <ChevronRight size={14} aria-hidden />
        ) : (
          <ChevronDown size={14} aria-hidden />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span>{section.title}</span>
            {typeof section.count === 'number' && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--theme-text-muted, var(--theme-text-secondary))',
                  fontWeight: 500,
                }}
              >
                {section.count}
              </span>
            )}
          </div>
          {section.description && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--theme-text-muted, var(--theme-text-secondary))',
                marginTop: 2,
              }}
            >
              {section.description}
            </div>
          )}
        </div>
      </button>
      {!collapsed && <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{section.children}</ul>}
    </section>
  );
}

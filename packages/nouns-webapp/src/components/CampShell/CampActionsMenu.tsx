import { useEffect, useRef, useState } from 'react';

import { ChevronDown, Edit3, FilePlus2, Plus, Vote } from 'lucide-react';
import { Link } from 'react-router';

interface MenuItem {
  to?: string;
  href?: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
}

const items: MenuItem[] = [
  {
    to: '/create-proposal',
    label: 'New proposal',
    icon: <FilePlus2 size={14} />,
    description: 'Submit on-chain (requires threshold votes)',
  },
  {
    to: '/create-candidate',
    label: 'New candidate',
    icon: <Edit3 size={14} />,
    description: 'Anyone can propose a candidate',
  },
  {
    to: '/delegate',
    label: 'Delegate votes',
    icon: <Vote size={14} />,
  },
];

/**
 * Mirrors Camp's "create-menu" dropdown that appears next to the brand. Camp
 * builds it through the `actions={[{extends:'create-menu'}, ...]}` slot in
 * `Layout`; we inline the same item set here for the Camp landing.
 */
export default function CampActionsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--theme-text-primary)',
          background: 'var(--theme-bg-tertiary, transparent)',
          border: '1px solid var(--theme-border)',
          borderRadius: 'var(--theme-radius-sm, 4px)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        <Plus size={14} aria-hidden />
        New
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 240,
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            borderRadius: 'var(--theme-radius-md, 6px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 4,
            zIndex: 50,
          }}
        >
          {items.map(item => {
            const inner = (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    color: 'var(--theme-text-secondary)',
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</span>
                  {item.description && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--theme-text-muted, var(--theme-text-secondary))',
                        marginTop: 1,
                      }}
                    >
                      {item.description}
                    </span>
                  )}
                </span>
              </>
            );
            const styleProps = {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 'var(--theme-radius-sm, 4px)',
              color: 'var(--theme-text-primary)',
              textDecoration: 'none',
              fontFamily: 'inherit',
              cursor: 'pointer',
            };
            if (item.to) {
              return (
                <Link
                  key={item.label}
                  role="menuitem"
                  to={item.to}
                  onClick={() => setOpen(false)}
                  style={styleProps}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <a
                key={item.label}
                role="menuitem"
                href={item.href}
                onClick={() => setOpen(false)}
                style={styleProps}
              >
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

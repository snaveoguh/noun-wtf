import { FC, ReactNode } from 'react';

interface ProbeButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Probe-style 3D push button — yellow rectangle with offset black shadow.
 * Inspired by probe.wtf/nouns/dreams button.
 *
 * - Bright yellow (#ffef2e) background
 * - 2px solid black border
 * - Hard pixel-art drop shadow: 8px right, 6px down, solid black
 * - On :active / click, shadow disappears (button pushes flat)
 */
export const ProbeButton: FC<ProbeButtonProps> = ({ children, onClick, disabled, className = '' }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`probe-btn ${className}`}
      style={{
        background: '#ffef2e',
        border: '2px solid #000',
        boxShadow: '8px 6px 0 0 #000',
        color: '#000',
        fontWeight: 700,
        fontSize: '1.25rem',
        padding: '0.5rem 1.5rem',
        minHeight: '35px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'box-shadow 0.1s ease, transform 0.1s ease',
        position: 'relative',
        textTransform: 'uppercase',
        fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
        letterSpacing: '0.05em',
      }}
      onMouseDown={e => {
        if (disabled) return;
        const btn = e.currentTarget;
        btn.style.boxShadow = 'none';
        btn.style.transform = 'translate(8px, 6px)';
      }}
      onMouseUp={e => {
        const btn = e.currentTarget;
        btn.style.boxShadow = '8px 6px 0 0 #000';
        btn.style.transform = 'translate(0, 0)';
      }}
      onMouseLeave={e => {
        const btn = e.currentTarget;
        btn.style.boxShadow = '8px 6px 0 0 #000';
        btn.style.transform = 'translate(0, 0)';
      }}
    >
      {children}
    </button>
  );
};

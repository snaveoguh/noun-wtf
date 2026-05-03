/**
 * Liquid Sand UI — <GlassTabs>
 *
 * Segmented tabs with a glass active pill that slides under the
 * selected option (visually). Controlled or uncontrolled.
 *
 * Pattern: <GlassTabs value=... onValueChange=...>
 *            <GlassTabs.Item value="x">…</GlassTabs.Item>
 *          </GlassTabs>
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GlassTabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  size: 'sm' | 'md' | 'lg';
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

const TRACK_SIZE_CLASS = {
  sm: 'h-7 p-0.5 gap-0.5',
  md: 'h-9 p-1 gap-1',
  lg: 'h-11 p-1 gap-1',
} as const;

const ITEM_SIZE_CLASS = {
  sm: 'px-2.5 text-xs',
  md: 'px-3.5 text-sm',
  lg: 'px-4 text-sm',
} as const;

function GlassTabsRoot({
  value: controlledValue,
  defaultValue,
  onValueChange,
  size = 'md',
  className,
  style,
  children,
  ...rest
}: GlassTabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internal;

  const setValue = React.useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v);
      onValueChange?.(v);
    },
    [isControlled, onValueChange],
  );

  const trackStyle: React.CSSProperties = {
    backgroundColor: 'var(--ls-glass-light)',
    backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
    WebkitBackdropFilter:
      'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
    borderRadius: 'var(--ls-r-full)',
    boxShadow:
      'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
    color: 'var(--ls-fg-primary)',
    ...style,
  };

  return (
    <TabsContext.Provider value={{ value, setValue, size }}>
      <div
        role="tablist"
        data-ls-tabs=""
        className={cn(
          'inline-flex items-center',
          TRACK_SIZE_CLASS[size],
          className,
        )}
        style={trackStyle}
        {...rest}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface GlassTabsItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

function GlassTabsItem({
  value,
  className,
  style,
  children,
  onClick,
  ...rest
}: GlassTabsItemProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error('GlassTabs.Item must be used inside a <GlassTabs>');
  }
  const active = ctx.value === value;

  const itemStyle: React.CSSProperties = {
    backgroundColor: active ? 'var(--ls-glass-light-strong)' : 'transparent',
    color: active ? 'var(--ls-fg-primary)' : 'var(--ls-fg-secondary)',
    borderRadius: 'var(--ls-r-full)',
    boxShadow: active
      ? 'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-sm)'
      : 'none',
    transition:
      'background-color var(--ls-dur-base) var(--ls-ease-soft), box-shadow var(--ls-dur-base) var(--ls-ease-soft), color var(--ls-dur-base) var(--ls-ease-soft)',
    ...style,
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-ls-tabs-item=""
      data-active={active ? '' : undefined}
      onClick={(e) => {
        ctx.setValue(value);
        onClick?.(e);
      }}
      className={cn(
        'h-full inline-flex items-center justify-center font-medium select-none cursor-pointer outline-none',
        ITEM_SIZE_CLASS[ctx.size],
        className,
      )}
      style={itemStyle}
      {...rest}
    >
      {children}
    </button>
  );
}

export const GlassTabs = Object.assign(GlassTabsRoot, {
  Item: GlassTabsItem,
});

export default GlassTabs;

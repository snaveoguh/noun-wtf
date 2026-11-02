import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin';
import tailwindcssAnimate from 'tailwindcss-animate';

import { CONTAINER_BREAKPOINTS } from './src/lib/responsive/breakpoints';

/**
 * Container-query variants on the shared tokens (src/lib/responsive):
 * `@md:flex` applies once the nearest size container (every NounOS window's
 * `.nos-content`) is at least 560 px wide; `@max-md:hidden` below 560 px.
 * `@container` makes an element a container itself. Viewport `sm:` / `md:`
 * still exist for the OS chrome, but pages should use these.
 */
const containerQueries = plugin(({ addVariant, addUtilities }) => {
  addUtilities({
    '.\\@container': { 'container-type': 'inline-size' },
  });
  const tiers = Object.entries(CONTAINER_BREAKPOINTS);
  // Registration order is cascade order: min-width ascending, then max-width
  // descending, so the narrower rule wins when two apply.
  for (const [name, px] of tiers) addVariant(`@${name}`, `@container (min-width: ${px}px)`);
  for (const [name, px] of [...tiers].reverse())
    addVariant(`@max-${name}`, `@container (max-width: ${px - 0.02}px)`);
});

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        londrina: ['Comic Sans MS', 'Comic Sans', 'cursive'],
        sans: ['Comic Sans MS', 'Comic Sans', 'cursive'],
      },
      screens: {
        xs: '425px',
        '2xl': '1440px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        cool: {
          background: 'var(--brand-cool-background)',
        },
        warm: {
          background: 'var(--brand-warm-background)',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
    },
  },
  plugins: [tailwindcssAnimate, containerQueries],
} satisfies Config;

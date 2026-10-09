import type { Config } from 'tailwindcss';

// The game UI (HUD, character select, touch sticks) is written with
// Tailwind utility classes, so scan the game sources too.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../nouns-webapp/src/miniapps/world2/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '425px',
        '2xl': '1440px',
      },
    },
  },
  plugins: [],
} satisfies Config;

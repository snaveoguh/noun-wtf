# Extracting Liquid Sand

How to lift this folder out of noun.wtf and into your own project. Should take about five minutes.

## 1. Copy the folder

Copy the entire `liquid-sand/` folder into your project's source directory. The exact location doesn't matter; common choices:

```
src/liquid-sand/                  # most React projects
app/lib/liquid-sand/              # Next.js
packages/liquid-sand/             # monorepo
```

The folder is fully self-contained. It does not import anything outside itself.

## 2. Import the global CSS once

Liquid Sand ships its design tokens as both TypeScript constants (`tokens.ts`) and CSS custom properties (`tokens.css`). The CSS file must be imported **once** at the entry point of your app so the `--ls-*` variables are available globally:

```ts
// main.tsx / index.tsx / app/layout.tsx — pick your entry
import './liquid-sand/tokens.css';
```

That's it for the CSS side. You don't need a CSS-in-JS runtime, a theme provider, or a build plugin.

## 3. Adjust the import alias (optional)

The components inside this folder use **relative imports** for cross-file references (e.g., `./Panel` from `index.ts`), so they work without any alias setup.

If you prefer to consume Liquid Sand via an alias from your app code (e.g., `@/liquid-sand`), add the alias to your tsconfig and bundler:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/liquid-sand": ["./src/liquid-sand"],
      "@/liquid-sand/*": ["./src/liquid-sand/*"]
    }
  }
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@/liquid-sand': path.resolve(__dirname, 'src/liquid-sand'),
    },
  },
});
```

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      '@/liquid-sand': path.resolve(__dirname, 'src/liquid-sand'),
    },
  },
};
```

If you don't want aliases, just use relative imports from your app code: `import { GlassPanel } from './liquid-sand'`.

## 4. Install peer dependencies

Liquid Sand is a React library and needs:

```jsonc
{
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  }
}
```

If your project already uses React 18+, you're done. There are no other runtime dependencies.

## 5. Use it

```tsx
import { GlassPanel, GlassButton } from './liquid-sand';
import { Folder, Sparkle } from './liquid-sand/icons';

export function App() {
  return (
    <GlassPanel blur="medium" radius="lg">
      <Folder size={20} />
      <span>Hello, sand.</span>
      <GlassButton variant="primary">
        <Sparkle size={16} /> Go
      </GlassButton>
    </GlassPanel>
  );
}
```

## Browser support & fallback

Liquid Sand's frosted-glass look depends on the CSS `backdrop-filter` property, which is now supported in all evergreen browsers (Chrome 76+, Firefox 103+, Safari 9+ with `-webkit-` prefix). For users on older browsers, the panels degrade to a transparent surface that looks washed out. Add this fallback to your global CSS to give them a solid sepia tint instead:

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  /* Replace .ls-glass with whatever className(s) you've targeted. The
     primitives also accept className/style props, so you can tag them
     yourself if needed. */
  [class*="ls-glass"],
  .ls-glass {
    background: var(--ls-sand-100) !important;
    -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
  }
}
```

For background-aware inversion: `<BlendIcon>` (CSS-only) and `<AdaptiveColor>` (JS sampling) both work in every modern browser. Only `registerHoudiniWorklet()` is Chromium-exclusive — and it's a pure progressive enhancement that silently no-ops where unsupported, so you can ship it without checks.

## Going further: extracting to its own npm package

The included `package.json` is a stub. If you want to publish Liquid Sand as a standalone package:

1. Move the folder into its own git repo.
2. Flip `package.json` `private` from `true` to `false`.
3. Add a build step (tsup, bunchee, vite-lib) that emits `dist/index.js` + `dist/index.d.ts`.
4. Update `package.json` `main`, `module`, `types`, and `exports` to point at `dist/`.
5. `npm publish` (or `pnpm publish`).

Because everything is CC0, you don't need anyone's permission to do this. Fork it, rename it, sell it, or just use it. The license is the manifesto.

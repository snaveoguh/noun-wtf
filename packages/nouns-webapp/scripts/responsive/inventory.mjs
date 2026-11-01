#!/usr/bin/env node
// Writes docs/responsive/pages.md from the harness's index.json + per-route
// reports, plus a scan of each route's source for viewport-based layout code.
//
//   node scripts/responsive/harness.mjs --all --jobs 3   # first: fresh shots
//   node scripts/responsive/inventory.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES, WIDTHS, slugFor } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webapp = path.resolve(here, '../..');
const repo = path.resolve(webapp, '../..');
const src = path.join(webapp, 'src');
const shotsRoot = path.join(repo, '.claude', 'responsive-shots');
const app = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');

// ── source: route → element → file → components ────────────────────────
const importOf = new Map();
for (const m of app.matchAll(/const (\w+) = lazy\(\(\) => import\('([^']+)'\)\)/g)) importOf.set(m[1], m[2]);
for (const m of app.matchAll(/^import (\w+) from '([^']+)';/gm)) importOf.set(m[1], m[2]);

function elementFor(routePath) {
  if (routePath === '/') return 'AgentHome';
  if (routePath.startsWith('explore/wallet') || routePath.startsWith('gamer')) return 'WalletProfilePage';
  const i = app.indexOf(`path="${routePath}"`);
  if (i < 0) return null;
  const m = app.slice(i).match(/<(?!Suspense\b|Route\b|\w*Skeleton\b)([A-Z]\w+)/);
  return m ? m[1] : null;
}

function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** The page's own files (its folder if it has one) + the components it imports directly. */
function filesFor(entry) {
  const files = new Set();
  const dir = path.dirname(entry);
  const own = path.basename(entry).startsWith('index.') || /pages\/[^/]+$/.test(dir) || /miniapps\/[^/]+$/.test(dir);
  const addDir = d => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile() && /\.(tsx|ts|css)$/.test(f) && !/\.test\./.test(f)) files.add(p);
    }
  };
  if (own && dir !== src) addDir(dir);
  else files.add(entry);
  const components = new Set();
  for (const f of [...files].filter(f => /\.tsx?$/.test(f))) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/from '(@\/components\/[^']+|\.\/[^']+|\.\.\/[^']+)'/g)) {
      const r = resolve(m[1], f);
      if (!r) continue;
      if (m[1].startsWith('@/components/')) components.add(m[1].replace('@/components/', '').split('/')[0]);
      const rd = path.dirname(r);
      if (m[1].startsWith('@/components/') && rd !== src) addDir(rd);
      else files.add(r);
    }
    for (const m of code.matchAll(/import\('(@\/components\/[^']+)'\)/g)) {
      components.add(m[1].replace('@/components/', '').split('/')[0]);
      const r = resolve(m[1], f);
      if (r) addDir(path.dirname(r));
    }
  }
  return { files: [...files], components: [...components].sort() };
}

const VIEWPORT = [
  ['@media width', /@media[^{]*\((max|min)-width/g, /\.css$/],
  ['innerWidth', /innerWidth/g, /\.tsx?$/],
  ['matchMedia width', /matchMedia\(\s*['"`][^'"`]*(max|min)-width/g, /\.tsx?$/],
  ['tailwind viewport', /[\s"'`](?:max-)?(?:xs|sm|md|lg|xl|2xl):[a-z[!-]/g, /\.tsx?$/],
  ['bootstrap grid', /<Col\b[^>]*\b(xs|sm|md|lg|xl)=/g, /\.tsx$/],
];

function scan(files) {
  const counts = {};
  let total = 0;
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    for (const [name, re, ext] of VIEWPORT) {
      if (!ext.test(f)) continue;
      const n = (code.match(re) || []).length;
      if (n) {
        counts[name] = (counts[name] || 0) + n;
        total += n;
      }
    }
  }
  return { counts, total };
}

// ── harness results ────────────────────────────────────────────────────
const index = fs.existsSync(path.join(shotsRoot, 'index.json'))
  ? JSON.parse(fs.readFileSync(path.join(shotsRoot, 'index.json'), 'utf8'))
  : { routes: [] };
const byUrl = new Map(index.routes.map(r => [r.url, r]));
const reportFor = url => {
  const f = path.join(shotsRoot, slugFor(url), 'report.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

const rows = ROUTES.map(r => {
  const el = elementFor(r.path);
  const spec = r.path === '/' ? '@/components/NounOS/AgentHome' : importOf.get(el);
  const entry = spec ? resolve(spec, path.join(src, 'App.tsx')) : null;
  const { files, components } = entry ? filesFor(entry) : { files: [], components: [] };
  const vp = scan(files);
  const idx = byUrl.get(r.url);
  const rep = reportFor(r.url);
  return {
    ...r,
    element: el,
    entry: entry ? path.relative(webapp, entry) : '?',
    components,
    fileCount: files.length,
    viewport: vp,
    severity: idx?.severity ?? null,
    shots: idx?.shots ?? [],
    report: rep,
  };
});

// ── work units ────────────────────────────────────────────────────────
const sev = r => r.severity?.score ?? 0;
const effort = r => r.viewport.total;
const sorted = [...rows].filter(r => r.path !== 'noun/:id' && r.path !== 'v2/noun/:id').sort((a, b) => sev(b) - sev(a) || effort(b) - effort(a));
const units = [];
const grouped = new Map();
const byEntry = new Map(); // routes rendering the same page component are one unit
for (const r of sorted) {
  const same = byEntry.get(r.entry);
  if (same && r.entry !== '?') {
    same.routes.push(r);
    continue;
  }
  if (sev(r) >= 6 || effort(r) >= 40) {
    const u = { routes: [r] };
    units.push(u);
    byEntry.set(r.entry, u);
  } else {
    const g = grouped.get(r.group) ?? { routes: [] };
    g.routes.push(r);
    grouped.set(r.group, g);
  }
}
for (const g of grouped.values()) {
  // split a group when its combined effort gets big
  let cur = { routes: [] };
  for (const r of g.routes) {
    if (cur.routes.length && cur.routes.reduce((a, x) => a + effort(x), 0) + effort(r) > 60) {
      units.push(cur);
      cur = { routes: [] };
    }
    cur.routes.push(r);
  }
  if (cur.routes.length) units.push(cur);
}
const unitScore = u => Math.max(...u.routes.map(sev)) + u.routes.reduce((a, r) => a + sev(r), 0) / 100;
units.sort((a, b) => unitScore(b) - unitScore(a));

// ── markdown ──────────────────────────────────────────────────────────
const short = n => (n === null || n === undefined ? '·' : n === 0 ? '✓' : String(Math.round(n)));
function widthLine(r, mode) {
  const ss = r.shots.filter(s => s.mode === mode);
  if (!ss.length) return mode === 'window' && r.kind === 'home' ? 'n/a (no window)' : 'not run';
  return WIDTHS.map(w => {
    const s = ss.find(x => x.width === w);
    return `${w}:${s ? (s.error ? 'ERR' : short(s.score)) : '·'}`;
  }).join(' ');
}
function topIssues(rep) {
  if (!rep) return [];
  const seen = new Map();
  const add = (kind, sel, w) => {
    const key = `${kind} ${sel}`;
    const e = seen.get(key) ?? { kind, sel, widths: [] };
    if (!e.widths.includes(w)) e.widths.push(w);
    seen.set(key, e);
  };
  for (const s of rep.shots) {
    const tag = `${s.mode[0]}${s.width}`;
    const i = s.issues ?? {};
    for (const o of i.overflow?.offenders?.slice(0, 2) ?? []) add('overflow', o.selector, tag);
    for (const c of i.clipped?.slice(0, 2) ?? []) add('clipped', c.selector, tag);
    for (const c of i.covered?.slice(0, 2) ?? []) add('covered', `${c.selector} ← ${c.by}`, tag);
    for (const c of i.overArt?.slice(0, 1) ?? []) add('on art', c.selector, tag);
    for (const c of i.overlaps?.slice(0, 1) ?? []) add('overlap', `${c.a} × ${c.b}`, tag);
    if ((i.smallTargets?.length ?? 0) > 0) add('small taps', `${s.counts.smallTargets} controls`, tag);
  }
  return [...seen.values()].sort((a, b) => b.widths.length - a.widths.length).slice(0, 6);
}
const sum = rows.filter(r => r.severity);
const cleanAll = sum.filter(r => r.severity.clean === r.severity.total).length;

let md = `# Responsive inventory

Generated by \`node scripts/responsive/inventory.mjs\` from the width harness
(\`scripts/responsive/harness.mjs --all\`, ${index.generated ? index.generated.slice(0, 10) : 'not run yet'})
and a scan of each route's source. Pick a work unit from the top; follow
[PLAYBOOK.md](./PLAYBOOK.md). Re-run both commands after a unit lands.

- **Routes:** ${rows.length} (${rows.filter(r => r.kind === 'page').length} window pages + the homescreen); redirects: ${'`'}${'auction/:id, explore, nouns, dreams, dreams/create, memevalue'}${'`'}. Noun World / Warfare (\`/world\`, \`/warfare\`) are games, out of scope.
- **Measured:** ${sum.length} routes × up to 26 shots; ${cleanAll} routes clean at every width.
- **Severity** = the mean shot score (0 clean). Per shot: overflow 8 + px/25 (max 20), clipped text/controls 3 each, covered controls 4, controls on artwork 1.5, overlapping controls 2, small tap targets (touch only) 0.3 each, each capped.
- **Viewport code** = viewport-based layout hits in the route's own files + the components it imports directly (\`@media (max|min-width)\`, \`innerWidth\`, \`matchMedia\` widths, Tailwind \`sm:\`/\`md:\`…, bootstrap \`<Col lg=…>\`): a rough size of the conversion.
- Width lines: \`w\` = window mode, \`p\` = page mode; \`✓\` clean, a number = that shot's score, \`ERR\` = the shot failed (timeout, crash).

## Done

| route | status |
| --- | --- |
| \`/noun/:id\`, \`/v2/noun/:id\` (Auction) | pilot, ${(() => {
  const r = rows.find(x => x.path === 'noun/:id');
  return r?.severity ? `${r.severity.clean}/${r.severity.total} clean in the last --all run` : 'see PLAYBOOK.md';
})()} · before/after sheets in \`.claude/responsive-shots/noun-2062*/\` |

## Work units (worst first)

`;
units.forEach((u, i) => {
  const names = u.routes.map(r => `\`${r.url}\``).join(', ');
  const s = Math.max(...u.routes.map(sev));
  const e = [...new Map(u.routes.map(r => [r.entry, effort(r)])).values()].reduce((a, x) => a + x, 0);
  md += `${i + 1}. ${names} — severity ${s}, viewport code ${e}${u.routes.length > 1 ? ` (group: ${u.routes[0].group})` : ''}\n`;
});

md += `\n## Routes\n`;
for (const r of [...rows].sort((a, b) => sev(b) - sev(a))) {
  const vpc = Object.entries(r.viewport.counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  md += `\n### \`${r.url}\` — severity ${r.severity ? r.severity.score : 'not measured'}\n\n`;
  md += `- route \`${r.path}\` · ${r.kind === 'home' ? 'homescreen (no window)' : 'navigator window'} · group ${r.group}\n`;
  md += `- element \`${r.element ?? '?'}\` in \`${r.entry}\` (${r.fileCount} files scanned)\n`;
  md += `- components: ${r.components.length ? r.components.slice(0, 18).map(c => `\`${c}\``).join(', ') + (r.components.length > 18 ? ` +${r.components.length - 18}` : '') : '—'}\n`;
  md += `- viewport code: ${r.viewport.total} (${vpc})\n`;
  if (r.severity) {
    md += `- clean ${r.severity.clean}/${r.severity.total}${r.severity.errors ? `, ${r.severity.errors} errors` : ''}; worst ${r.severity.worst.join(', ') || '—'}\n`;
    md += `- w: ${widthLine(r, 'window')}\n- p: ${widthLine(r, 'page')}\n`;
    const top = topIssues(r.report);
    if (top.length) {
      md += `- top issues:\n`;
      for (const t of top) md += `  - ${t.kind}: \`${t.sel.slice(0, 110)}\` (${t.widths.slice(0, 8).join(' ')}${t.widths.length > 8 ? ' …' : ''})\n`;
    }
  }
}
const outDir = path.join(repo, 'docs', 'responsive');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pages.md'), md);
console.log(`wrote docs/responsive/pages.md: ${rows.length} routes, ${units.length} work units`);

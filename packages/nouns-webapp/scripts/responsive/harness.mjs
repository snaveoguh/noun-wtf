#!/usr/bin/env node
// Responsive width harness: every route at 13 widths, in a NounOS window and
// full-page, with automated layout checks and a contact sheet per route.
//
//   node scripts/responsive/harness.mjs --route /noun/2062
//   node scripts/responsive/harness.mjs --route /noun/2062 --mode window --widths 390,640
//   node scripts/responsive/harness.mjs --all --jobs 2          # the whole inventory
//
// Needs a dev server (vite) on --base (default http://127.0.0.1:5196); see
// docs/responsive/PLAYBOOK.md for the no-HMR config. Output goes to
// <repo>/.claude/responsive-shots/<route-slug>[/<label>]/:
//   window-<w>.png, page-<w>.png   shots (top of the page; --scroll 2 adds a second screen)
//   report.json                    per-shot issues + scores
//   contact-sheet.jpg              every shot on one sheet, issues printed under each
// and --all also writes .claude/responsive-shots/index.json (every route's severity).
//
// Options:
//   --route <url>      one route (repeatable); query strings allowed (?sections=heroTools)
//   --all              every route in lib.mjs ROUTES
//   --group <name>     routes of one group (auction, governance, …)
//   --mode both|window|page   (default both)
//   --widths a,b,c     subset of the 13 widths
//   --label <name>     subfolder, e.g. before / after
//   --settle <ms>      max wait for the network to go quiet after load (default 6000)
//   --scroll <n>       screens per shot, stacked on the sheet (default 1)
//   --jobs <n>         routes in parallel (default 1; each job has its own browser contexts)
//   --base <url>       dev server
//   --no-sheet         skip contact sheets
//   --fail-on-issues   exit 1 if any shot has a score > 0 (for a page session's "green" check)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { collect } from './inpage.mjs';
import {
  ROUTES,
  TOUCH_BELOW,
  WIDTHS,
  analyse,
  desktopFor,
  issueLine,
  routeFor,
  routeSeverity,
  slugFor,
  tierOf,
  viewportFor,
  windowRect,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webapp = path.resolve(here, '../..');
const repo = path.resolve(webapp, '../..');
const require = createRequire(path.join(webapp, 'package.json'));
const { chromium } = require('playwright');

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { routes: [], mode: 'both', settle: 6000, scroll: 1, jobs: 1, base: 'http://127.0.0.1:5196', sheet: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--route') opt.routes.push(next());
  else if (a === '--all') opt.all = true;
  else if (a === '--group') opt.group = next();
  else if (a === '--mode') opt.mode = next();
  else if (a === '--widths') opt.widths = next().split(',').map(Number);
  else if (a === '--label') opt.label = next();
  else if (a === '--settle') opt.settle = Number(next());
  else if (a === '--scroll') opt.scroll = Math.max(1, Number(next()));
  else if (a === '--jobs') opt.jobs = Math.max(1, Number(next()));
  else if (a === '--base') opt.base = next().replace(/\/$/, '');
  else if (a === '--out') opt.out = next();
  else if (a === '--no-sheet') opt.sheet = false;
  else if (a === '--fail-on-issues') opt.failOnIssues = true;
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).join('\n'));
    process.exit(0);
  } else {
    console.error(`unknown option ${a}`);
    process.exit(2);
  }
}
const widths = opt.widths ?? WIDTHS;
const outRoot = opt.out ? path.resolve(opt.out) : path.join(repo, '.claude', 'responsive-shots');
let urls = opt.routes;
if (opt.all) urls = ROUTES.map(r => r.url);
if (opt.group) urls = ROUTES.filter(r => r.group === opt.group).map(r => r.url);
if (urls.length === 0) {
  console.error('give --route <url>, --group <name> or --all (see --help)');
  process.exit(2);
}

const LAUNCH = {
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
};

// First load of every page in a context: wipe storage once, then seed what a
// returning visitor has (README seen) plus the navigator rect for this shot.
function seedScript({ rect }) {
  if (!sessionStorage.getItem('__rq')) {
    try {
      localStorage.clear();
    } catch {
      /* blocked */
    }
    sessionStorage.setItem('__rq', '1');
  }
  // the homepage ident plays once per session (home/Intro.tsx INTRO_KEY)
  sessionStorage.setItem('nounwtf-intro-v1', '1');
  localStorage.setItem('nounos-readme-seen', '1');
  if (rect) localStorage.setItem('nounos-layout-v1', JSON.stringify({ navigator: rect }));
  else localStorage.removeItem('nounos-layout-v1');
}

async function settle(page, max) {
  let inflight = 0;
  let last = Date.now();
  const on = () => {
    inflight++;
    last = Date.now();
  };
  const off = () => {
    inflight = Math.max(0, inflight - 1);
    last = Date.now();
  };
  page.on('request', on);
  page.on('requestfinished', off);
  page.on('requestfailed', off);
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    if (inflight === 0 && Date.now() - last > 800) break;
    await page.waitForTimeout(200);
  }
  page.off('request', on);
  page.off('requestfinished', off);
  page.off('requestfailed', off);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function load(page, url) {
  await page.goto(opt.base + url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page
    .waitForSelector('.nos-root', { timeout: 120000 })
    .catch(() => {});
  if (routeFor(url).kind === 'page') {
    await page.waitForSelector('.nos-win[data-nos-win="navigator"] .nos-content', { timeout: 120000 });
  }
  await settle(page, opt.settle);
}

async function screens(page, file, clipEl) {
  const files = [];
  for (let i = 0; i < opt.scroll; i++) {
    if (i > 0) {
      const moved = await page.evaluate(() => {
        const c = document.querySelector('.nos-win[data-nos-win="navigator"] .nos-content') || document.scrollingElement;
        const before = c.scrollTop;
        c.scrollTop = before + c.clientHeight * 0.9;
        return c.scrollTop !== before;
      });
      if (!moved) break;
      await page.waitForTimeout(400);
    }
    const f = i === 0 ? file : file.replace(/\.png$/, `-s${i + 1}.png`);
    if (clipEl) await clipEl.screenshot({ path: f, animations: 'disabled', timeout: 120000 });
    else await page.screenshot({ path: f, animations: 'disabled', timeout: 120000 });
    files.push(path.basename(f));
  }
  await page.evaluate(() => {
    const c = document.querySelector('.nos-win[data-nos-win="navigator"] .nos-content') || document.scrollingElement;
    c.scrollTop = 0;
  });
  return files;
}

async function shoot(page, { url, mode, width, dir, touch }) {
  const raw = await page.evaluate(collect, { allowDocument: routeFor(url).kind === 'home' });
  const result = analyse(raw, { touch });
  const file = path.join(dir, `${mode}-${width}.png`);
  const clipEl = mode === 'window' ? await page.$('.nos-win[data-nos-win="navigator"]') : null;
  const shots = await screens(page, file, clipEl);
  const contentWidth = raw?.content?.clientWidth ?? null;
  return {
    mode,
    width,
    viewport: raw?.viewport ?? null,
    contentWidth,
    tier: contentWidth ? tierOf(contentWidth) : null,
    touch,
    score: result.score,
    counts: result.counts,
    line: issueLine(result.counts),
    issues: result.issues,
    error: result.error,
    shots,
  };
}

async function runWindowMode(browser, url, dir, log) {
  const out = [];
  const ws = widths.filter(w => w >= 320);
  // one page per desktop size; resize the navigator live between widths
  const groups = new Map();
  for (const w of ws) {
    const d = desktopFor(w);
    const k = `${d.width}x${d.height}`;
    if (!groups.has(k)) groups.set(k, { desktop: d, widths: [] });
    groups.get(k).widths.push(w);
  }
  for (const { desktop, widths: gw } of groups.values()) {
    const ctx = await browser.newContext({ viewport: desktop, deviceScaleFactor: 1 });
    await ctx.addInitScript(seedScript, { rect: windowRect(gw[0], desktop) });
    const page = await ctx.newPage();
    try {
      await load(page, url);
      for (const w of gw) {
        const rect = windowRect(w, desktop);
        await page.evaluate(r => {
          const nos = window.__nos;
          if (!nos) throw new Error('window.__nos missing: run against a dev build');
          nos.focus('navigator');
          nos.move('navigator', r);
        }, rect);
        await page.waitForTimeout(500);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const s = await shoot(page, { url, mode: 'window', width: w, dir, touch: false });
        log(`  window ${String(w).padStart(4)} content ${s.contentWidth} ${s.tier} → ${s.line}`);
        out.push(s);
      }
    } catch (e) {
      log(`  window ${gw.join(',')}: ${e.message.split('\n')[0]}`);
      for (const w of gw) if (!out.find(s => s.width === w)) out.push({ mode: 'window', width: w, error: e.message.split('\n')[0], score: 0 });
    } finally {
      await ctx.close();
    }
  }
  return out;
}

async function runPageMode(browser, url, dir, log) {
  const out = [];
  for (const w of widths) {
    const touch = w < TOUCH_BELOW;
    const ctx = await browser.newContext({
      viewport: viewportFor(w),
      deviceScaleFactor: 1,
      isMobile: touch,
      hasTouch: touch,
    });
    await ctx.addInitScript(seedScript, { rect: null });
    const page = await ctx.newPage();
    try {
      await load(page, url);
      const s = await shoot(page, { url, mode: 'page', width: w, dir, touch });
      log(`  page   ${String(w).padStart(4)} content ${s.contentWidth} ${s.tier} → ${s.line}`);
      out.push(s);
    } catch (e) {
      log(`  page   ${w}: ${e.message.split('\n')[0]}`);
      out.push({ mode: 'page', width: w, error: e.message.split('\n')[0], score: 0 });
    } finally {
      await ctx.close();
    }
  }
  return out;
}

async function contactSheet(browser, dir, report) {
  const cell = s => {
    const imgs = (s.shots ?? [])
      .map(f => `<img src="${f}" style="height:${s.mode === 'window' ? 320 : 360}px">`)
      .join('');
    const cls = s.error ? 'err' : s.score > 0 ? 'bad' : 'ok';
    return `<figure><figcaption><b>${s.width}</b> <span>${s.contentWidth ?? '?'}px · ${s.tier ?? '?'}${s.touch ? ' · touch' : ''}</span><i class="${cls}">${s.error ? 'error: ' + s.error.slice(0, 60) : s.line}${s.score ? ` (${s.score})` : ''}</i></figcaption><div class="stack">${imgs}</div></figure>`;
  };
  const section = (mode, title) => {
    const ss = report.shots.filter(s => s.mode === mode);
    return ss.length ? `<h2>${title}</h2><div class="row">${ss.map(cell).join('')}</div>` : '';
  };
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#16171b;color:#eee;font:13px/1.35 ui-monospace,Menlo,monospace;width:2400px}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px;color:#bbb}
    .row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
    figure{margin:0;background:#202227;border-radius:8px;padding:8px}
    figcaption{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;max-width:520px}
    figcaption b{font-size:16px} figcaption span{color:#999}
    i{font-style:normal} .ok{color:#7ddc8a} .bad{color:#ff8a7a} .err{color:#ffcf5a}
    .stack{display:flex;flex-direction:column;gap:4px} img{display:block;border:1px solid #333;background:#fff}
  </style><h1>${report.url}</h1><div>${report.label ? report.label + ' · ' : ''}${report.generated} · severity ${report.severity.score} · clean ${report.severity.clean}/${report.severity.total}</div>
  ${section('window', 'In a NounOS window (desktop 1440 × 1000; 2600 × 1440 for ≥ 1440)')}
  ${section('page', 'Full page at that viewport (touch under 768)')}`;
  const sheetHtml = path.join(dir, 'contact-sheet.html');
  fs.writeFileSync(sheetHtml, html);
  const ctx = await browser.newContext({ viewport: { width: 2448, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto('file://' + sheetHtml);
  await page.waitForLoadState('load');
  await page.screenshot({ path: path.join(dir, 'contact-sheet.jpg'), fullPage: true, type: 'jpeg', quality: 72 });
  await ctx.close();
}

async function runRoute(browser, url, log) {
  const slug = slugFor(url);
  const dir = path.join(outRoot, slug, ...(opt.label ? [opt.label] : []));
  fs.mkdirSync(dir, { recursive: true });
  const route = routeFor(url);
  log(`▶ ${url} (${route.kind}) → ${path.relative(repo, dir)}`);
  const shots = [];
  if (opt.mode !== 'page' && route.kind === 'page') shots.push(...(await runWindowMode(browser, url, dir, log)));
  if (opt.mode !== 'window') shots.push(...(await runPageMode(browser, url, dir, log)));
  const report = {
    url,
    route: route.path,
    group: route.group,
    kind: route.kind,
    label: opt.label ?? null,
    generated: new Date().toISOString(),
    widths,
    severity: routeSeverity(shots),
    shots,
  };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  if (opt.sheet) await contactSheet(browser, dir, report).catch(e => log(`  sheet: ${e.message}`));
  log(`✔ ${url}: severity ${report.severity.score}, clean ${report.severity.clean}/${report.severity.total}`);
  return report;
}

const browser = await chromium.launch(LAUNCH);
const queue = [...urls];
const reports = [];
const started = Date.now();
await Promise.all(
  Array.from({ length: Math.min(opt.jobs, queue.length) }, async (_, j) => {
    const b = j === 0 ? browser : await chromium.launch(LAUNCH);
    while (queue.length) {
      const url = queue.shift();
      const lines = [];
      const log = s => (opt.jobs > 1 ? lines.push(s) : console.log(s));
      try {
        reports.push(await runRoute(b, url, log));
      } catch (e) {
        log(`✘ ${url}: ${e.message.split('\n')[0]}`);
      }
      if (lines.length) console.log(lines.join('\n'));
    }
    if (b !== browser) await b.close();
  }),
);
await browser.close();

if (urls.length > 1) {
  const idxFile = path.join(outRoot, opt.label ? `index-${opt.label}.json` : 'index.json');
  const prev = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : { routes: [] };
  const byUrl = new Map(prev.routes.map(r => [r.url, r]));
  for (const r of reports) {
    byUrl.set(r.url, {
      url: r.url,
      route: r.route,
      group: r.group,
      kind: r.kind,
      severity: r.severity,
      shots: r.shots.map(s => ({ mode: s.mode, width: s.width, contentWidth: s.contentWidth, score: s.score, counts: s.counts, error: s.error })),
    });
  }
  const routes = [...byUrl.values()].sort((a, b) => b.severity.score - a.severity.score);
  fs.writeFileSync(idxFile, JSON.stringify({ generated: new Date().toISOString(), widths, routes }, null, 2));
  console.log(`index → ${path.relative(repo, idxFile)}`);
}
console.log(`done: ${reports.length} route(s) in ${Math.round((Date.now() - started) / 1000)} s`);
if (opt.failOnIssues && reports.some(r => r.shots.some(s => s.error || s.score > 0))) process.exit(1);

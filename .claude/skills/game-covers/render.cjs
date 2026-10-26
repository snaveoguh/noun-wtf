const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [kind, img, out, portrait] = process.argv.slice(2);
const P = portrait === 'p';
(async () => {
  const u = new URL(process.env.HTTPS_PROXY);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }, args: ['--ignore-certificate-errors', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: P ? { width: 800, height: 1200 } : { width: 1200, height: 960 } });
  await p.goto('file://' + __dirname + '/cover.html?k=' + kind + '&img=' + encodeURIComponent('file://' + img) + (P ? '&p=1' : ''), { waitUntil: 'networkidle', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  console.log(await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(',')));
  await p.screenshot({ path: out });
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });

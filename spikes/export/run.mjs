import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
const channel = process.argv[2] === 'chrome' ? 'chrome' : undefined;
const headless = process.argv[3] !== 'headed';
const server = await createServer({ root: import.meta.dirname, server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel, headless, args: ['--enable-precise-memory-info'] });
const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5199/');
console.log('UA', await page.evaluate(() => navigator.userAgent), 'channel', channel, 'headless', headless);
console.log('VideoEncoder', await page.evaluate(() => typeof VideoEncoder));
import('node:child_process').then(()=>{});
const { execSync } = await import('node:child_process');
let peakRss = 0, peakByType = {};
const poll = setInterval(() => { try {
  const lines = execSync("ps -axo rss=,command= | grep -i 'Google Chrome' | grep -v grep").toString().split('\n');
  let tot = 0;
  for (const l of lines) { const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m) continue; const kb = +m[1]; tot += kb;
    const t = (m[2].match(/--type=([a-z-]+)/) || [,'browser'])[1]; peakByType[t] = Math.max(peakByType[t] || 0, kb); }
  peakRss = Math.max(peakRss, tot); } catch {} }, 500);
await page.evaluate(() => window.__start({}));
await page.waitForFunction(() => window.__result, null, { timeout: 25 * 60 * 1000, polling: 2000 });
const r = await page.evaluate(() => window.__result);
clearInterval(poll);
console.log('peakTotalRssMB', (peakRss/1024).toFixed(0), 'peakPerProcessMB', JSON.stringify(Object.fromEntries(Object.entries(peakByType).map(([k,v])=>[k,Math.round(v/1024)]))));
console.log(JSON.stringify(r, null, 1));
if (!r.error) {
  const b64 = await page.evaluate(() => window.__b64);
  fs.writeFileSync(new URL('./out.mp4', import.meta.url), Buffer.from(b64, 'base64'));
}
console.log(await page.evaluate(() => document.getElementById('log').textContent));
await browser.close(); await server.close();

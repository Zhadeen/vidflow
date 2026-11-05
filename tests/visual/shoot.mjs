// Serves tests/visual with Vite and screenshots each studio screen with installed Chrome.
// Usage: node tests/visual/shoot.mjs [outDir]   (playwright-core from the global @playwright/cli install)
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(repo, 'docs/design/build-check'));
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = await import(path.join(globalRoot, '@playwright/cli/node_modules/playwright-core/index.mjs'));

const server = await createServer({ root: here, configFile: false, plugins: [react()], server: { port: 5199, fs: { allow: [repo] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
const shots = [
  ['home', 1280, 800],
  ['script', 1280, 1100],
  ['idle', 1280, 900],
  ['running', 1280, 1000],
  ['paused', 1280, 1050],
  ['finished', 1280, 1150],
  ['running', 390, 1700, 'running-phone'],
  ['swap', 1280, 1000, 'pictures-step-swap'],
];
// Optional: only the named shots, e.g. `node tests/visual/shoot.mjs docs/design/build-check pictures-step-swap`.
const only = process.argv.slice(3);
for (const [screen, width, height, name] of shots.filter(([s, , , n]) => only.length === 0 || only.includes(n ?? s))) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:5199/?screen=${screen}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name ?? screen}.png`), fullPage: true });
  await page.close();
}
await browser.close();
await server.close();
console.log(`saved to ${out}`);

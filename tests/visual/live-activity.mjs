// Screenshots VidFlow's Flow-page overlays (pill, ring + tag, saved badges) with installed Chrome, and checks in a real
// browser that the ring never takes a click: a press at Generate's centre still lands on Generate.
// Usage: node tests/visual/live-activity.mjs [outDir]   (playwright-core from the global @playwright/cli install)
import { createServer } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(repo, 'docs/design/build-check'));
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = await import(path.join(globalRoot, '@playwright/cli/node_modules/playwright-core/index.mjs'));

const server = await createServer({ root: here, configFile: false, server: { port: 5198, fs: { allow: [repo] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
for (const [name, query] of [
  ['generate', 'target=generate'],
  ['tile', 'target=tile'],
  ['prompt', 'target=prompt'],
  ['off', 'target=generate&live=off'],
]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 470 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:5198/live-activity.html?${query}`);
  await page.waitForFunction(() => window.ready === true);
  await page.waitForTimeout(400); // let the fade-in finish
  await page.screenshot({ path: path.join(out, `live-activity-${name}.png`) });
  if (name === 'generate') {
    const box = await page.locator('#generate').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? null, [cx, cy]);
    await page.mouse.click(cx, cy);
    const presses = await page.evaluate(() => window.presses);
    const ringOn = await page.evaluate(() => !!document.getElementById('vidflow-highlight')?.shadowRoot?.querySelector('.ring'));
    console.log(`ring drawn: ${ringOn}; elementFromPoint at Generate centre: #${hit}; presses landed: ${presses}`);
    if (!ringOn || hit !== 'generate' || presses !== 1) failed = true;
  }
  await page.close();
}
await browser.close();
await server.close();
console.log(`saved to ${out}`);
if (failed) process.exit(1);

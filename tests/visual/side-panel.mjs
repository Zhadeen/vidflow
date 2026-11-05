// Screenshots the side panel (before starting, while it runs) at the approved 320px width with installed Chrome,
// plus the approved mockup's panels for comparison.
// Usage: node tests/visual/side-panel.mjs [outDir] [mockupOutDir]   (playwright-core from the global @playwright/cli install)
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(repo, 'docs/design/build-check'));
const mockOut = process.argv[3] ? path.resolve(process.argv[3]) : null;
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = await import(path.join(globalRoot, '@playwright/cli/node_modules/playwright-core/index.mjs'));

const server = await createServer({ root: here, configFile: false, plugins: [react()], server: { port: 5197, fs: { allow: [repo] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });

const HEIGHTS = { setup: 720, 'setup-unapplied': 760, checks: 860, running: 760, 'queue-finished': 760, 'queue-options': 900, files: 720 };
// Optional: only the named screens, e.g. `node tests/visual/side-panel.mjs docs/design/build-check '' files`.
const only = process.argv.slice(4);
const SCREENS = ['setup', 'setup-unapplied', 'checks', 'running', 'queue-finished', 'queue-options', 'files'];
for (const screen of SCREENS.filter((s) => only.length === 0 || only.includes(s))) {
  const page = await browser.newPage({ viewport: { width: 320, height: HEIGHTS[screen] }, deviceScaleFactor: 2 });
  const data = screen === 'running' ? 'running' : screen.startsWith('queue-') || screen === 'files' ? 'finished' : 'setup';
  await page.goto(`http://localhost:5197/side-panel.html?screen=${data}`);
  await page.waitForFunction(() => window.ready === true);
  if (screen === 'setup' || screen === 'checks') {
    // Paste Claude's reply, then use the scenes: the mockup's "before starting" state.
    const REPLY = await page.evaluate(() => window.REPLY);
    await page.getByRole('textbox', { name: "Paste Claude's reply" }).fill(REPLY);
    await page.getByRole('button', { name: 'Use these scenes' }).click();
    await page.getByRole('button', { name: 'Start making pictures' }).waitFor();
  }
  if (screen === 'setup-unapplied') {
    // Pasted but not used yet: "✓ 6 scenes found · no problems  Use these scenes", the coral Start waiting.
    const REPLY = await page.evaluate(() => window.REPLY);
    await page.getByRole('textbox', { name: "Paste Claude's reply" }).fill(REPLY);
    await page.getByRole('button', { name: 'Use these scenes' }).waitFor();
  }
  if (screen === 'checks') {
    await page.getByRole('tab', { name: 'Checks' }).click();
    await page.getByRole('button', { name: 'Check again' }).waitFor();
  } else if (screen === 'running') {
    await page.getByRole('button', { name: 'Pause' }).waitFor();
  } else if (screen === 'files') {
    // A finished video's Files tab: five scenes saved with two options each.
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('button', { name: /^Download all/ }).waitFor();
  } else if (screen.startsWith('queue-')) {
    // A finished video: the Queue shows its scenes as saved, with Retry failed and ▶ Run.
    await page.getByRole('tab', { name: /^Queue/ }).click();
    await page.getByRole('button', { name: 'Retry failed' }).waitFor();
    if (screen === 'queue-options') await page.locator('li[data-scene="scene-02"] button[aria-expanded]').click();
  }
  await page.waitForTimeout(300);
  // The Queue scrolls in the real panel: shoot the whole page so the rows and the Pause/Stop/Skip row both show.
  const fullPage = screen === 'running' || screen.startsWith('queue-');
  await page.screenshot({ path: path.join(out, `side-panel-${screen}.png`), fullPage });
  await page.close();
}

if (mockOut) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:5197/@fs${path.join(repo, 'docs/design/approved/side-panel-v2.html')}`);
  const panels = page.locator('.vp');
  for (const [i, name] of ['setup', 'queue', 'checks', 'files'].entries()) await panels.nth(i).screenshot({ path: path.join(mockOut, `mock-${name}.png`) });
  await page.close();
}

await browser.close();
await server.close();
console.log(`saved to ${out}`);

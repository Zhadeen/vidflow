import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEL } from '../../src/flow/selectors';

/** The Flow helper (content script) loaded into jsdom with a minimal chrome; its message listener is captured. */
type OnMessage = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
let onMessage: OnMessage;

interface Boot {
  /** The page's markup (a fixture name). */
  fixture?: string;
  /** What the background answers for this tab's pill: null = no run here. */
  pill?: unknown;
  /** Extra chrome.storage.local values. */
  stored?: Record<string, unknown>;
}

let sendMessage: ReturnType<typeof vi.fn>;

/** Loads the Flow helper into jsdom: `fixture` as the page, `pill` as the background's answer for this tab. */
async function boot({ fixture = 'prompt-bar.html', pill = null, stored = {} }: Boot = {}) {
  vi.resetModules();
  document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/flow', fixture), 'utf8');
  const data: Record<string, unknown> = { expectedAccount: 'owner@example.com', ...stored };
  vi.stubGlobal('defineContentScript', (def: { main: () => void }) => def);
  sendMessage = vi.fn(async (m: { type?: string }) => (m?.type === 'flow/pill' ? pill : null));
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'vidflow',
      sendMessage, // no run unless `pill` says so: the pill stays hidden
      onMessage: { addListener: (l: OnMessage) => (onMessage = l) },
    },
    storage: {
      local: { get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})) },
      onChanged: { addListener: vi.fn() },
    },
  });
  const script = (await import('../../src/entrypoints/flow.content')).default as unknown as { main: () => void };
  script.main();
}

beforeEach(() => boot());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const ask = (message: unknown) =>
  new Promise((resolve) => {
    expect(onMessage(message, {}, resolve)).toBe(true);
  });

describe('Flow helper: Test one prompt', () => {
  it('clears the prompt again when typing it fails, and never presses Generate', async () => {
    // Flow's editor takes only part of the text: the typed check fails after something is in the box.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((cmd: string, _ui?: boolean, value?: string) => {
        if (cmd === 'insertText') document.querySelector(SEL.promptBox)!.innerHTML = `<p>${(value ?? '').slice(0, 7)}</p>`;
        return true;
      }),
    });
    document.querySelector(SEL.promptBar)!.insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    const clear = vi.fn(() => (document.querySelector(SEL.promptBox)!.innerHTML = '<p><br></p>'));
    document.querySelector(SEL.clearPrompt)!.addEventListener('click', clear);
    const generate = vi.fn();
    document.querySelector(SEL.generate)!.addEventListener('click', generate);

    const reply = (await ask({ type: 'flow/test-prompt', aspect: '9:16', outputs: 2 })) as { ok: boolean; message: string };
    expect(reply.ok).toBe(false);
    expect(reply.message).toMatch(/couldn't type the prompt/);
    expect(clear).toHaveBeenCalled();
    expect(document.querySelector(SEL.promptBox)!.textContent).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('Flow helper: checks', () => {
  it('reads the page without clicking anything', async () => {
    const reply = await ask({ type: 'flow/checks' });
    expect(reply).toEqual({
      account: 'owner@example.com',
      page: true,
      promptBox: true,
      generate: true,
      agentOff: true,
      model: 'Nano Banana 2.1',
      aspect: '9:16',
      outputs: 2,
      credits: null,
      creditsResets: null,
      noticeDialog: false,
      billingDialog: false,
    });
  });
});

/** A run's pill as the background sends it (running unless `paused`). */
const pillOf = (paused: boolean) => ({
  n: 1,
  total: 2,
  paused,
  step: null,
  scene: null,
  saved: 0,
  drawing: 0,
  toGo: 2,
  highlight: null,
  savedCards: [],
});
const until = async (check: () => boolean) => {
  for (let i = 0; i < 600 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('Flow helper: Test one prompt refusals match the run', () => {
  it('a running run: "making pictures right now"; a paused run: "has a paused run"', async () => {
    const { TEST_WHILE_PAUSED_MESSAGE, TEST_WHILE_RUNNING_MESSAGE } = await import('../../src/flow/messages');
    expect(TEST_WHILE_PAUSED_MESSAGE).toBe('VidFlow has a paused run. Resume or stop it first.');
    await boot({ pill: pillOf(false) });
    await until(() => sendMessage.mock.calls.some(([m]) => m?.type === 'flow/pill'));
    await new Promise((r) => setTimeout(r, 20));
    expect(await ask({ type: 'flow/test-prompt', aspect: '9:16', outputs: 2 })).toEqual({ ok: false, message: TEST_WHILE_RUNNING_MESSAGE });
    await boot({ pill: pillOf(true) });
    await until(() => sendMessage.mock.calls.some(([m]) => m?.type === 'flow/pill'));
    await new Promise((r) => setTimeout(r, 20));
    expect(await ask({ type: 'flow/test-prompt', aspect: '9:16', outputs: 2 })).toEqual({ ok: false, message: TEST_WHILE_PAUSED_MESSAGE });
  });

  it("Test one prompt's home-page refusals say \"try again\", never \"press Start\"", async () => {
    await boot({ fixture: 'home.html' });
    document.querySelector(SEL.account)!.remove(); // signed out
    // jsdom lays nothing out: give the New project button a place on screen.
    const rect = { x: 10, y: 10, width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    const reply = (await ask({ type: 'flow/new-project', verb: 'Test' })) as { kind: string; event: { message: string } };
    expect(reply.kind).toBe('blocked');
    expect(reply.event.message).toBe('Flow isn\'t signed in. Sign in to Flow as owner@example.com, then try again.');
    expect(reply.event.message).not.toMatch(/press Start/);
  });
});

describe("Flow helper: a usage notice while VidFlow waits for tiles", () => {
  const notice = () => readFileSync(resolve(__dirname, '../fixtures/flow/usage-notice.html'), 'utf8');
  const sentTypes = () => sendMessage.mock.calls.map(([m]) => (m as { type?: string })?.type);

  it('with the switch on, the helper tells the background (which accepts it), and never reports a pause itself', async () => {
    await boot({ pill: pillOf(false) });
    document.body.insertAdjacentHTML('beforeend', notice());
    await until(() => sentTypes().includes('flow/notice'));
    expect(sentTypes()).toContain('flow/notice');
    expect(sendMessage.mock.calls.some(([m]) => (m as { type?: string })?.type === 'flow/event')).toBe(false);
  });

  it('with the switch off, it reports the pause as before (no notice event)', async () => {
    await boot({ pill: pillOf(false), stored: { 'vidflow.acceptNotices': false } });
    document.body.insertAdjacentHTML('beforeend', notice());
    await until(() => sentTypes().includes('flow/event'));
    const event = sendMessage.mock.calls.map(([m]) => m as { type?: string; event?: { reason?: string } }).find((m) => m.type === 'flow/event');
    expect(event?.event?.reason).toBe('policy-dialog');
    expect(sentTypes()).not.toContain('flow/notice');
  });
});

describe('Flow helper: clips and Agent questions (Plan 3)', () => {
  it('answers with the video tiles, the Generate cost and an empty clip page read', async () => {
    await boot({ fixture: 'video-prompt-bar.html' });
    document.body.insertAdjacentHTML('beforeend', readFileSync(resolve(__dirname, '../fixtures/flow/video-tiles.html'), 'utf8'));
    const tiles = (await ask({ type: 'flow/video-tiles-now' })) as { cards: Array<{ key: string; video?: true }> };
    expect(tiles.cards.map((c) => c.key)).toEqual(['pending-0', 'video-1', 'frame-media-1']);
    expect(await ask({ type: 'flow/generate-cost' })).toEqual({ cost: 14 });
  });

  it('a billing dialog blocks preparing a clip, and nothing in it is pressed', async () => {
    await boot({ fixture: 'video-prompt-bar.html' });
    document.body.insertAdjacentHTML('beforeend', readFileSync(resolve(__dirname, '../fixtures/flow/billing-dialog.html'), 'utf8'));
    const pressed = vi.fn();
    document.querySelectorAll('mat-dialog-container button').forEach((b) => b.addEventListener('click', pressed));
    const reply = (await ask({
      type: 'flow/prepare-clip',
      prompt: 'The stickman waves',
      aspect: '16:9',
      length: 4,
      startFrame: 'vidflow-s01.png',
    })) as { kind: string; notice?: true };
    expect(reply.kind).toBe('blocked');
    expect(reply.notice).toBeUndefined();
    expect(pressed).not.toHaveBeenCalled();
  });

  it('finishing the Agent turns its mode off; a reply asked for without a question waits', async () => {
    await boot();
    const chip = document.querySelector<HTMLElement>('.agent-mode-chip')!;
    chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', () => chip.setAttribute('aria-pressed', 'false'));
    expect(await ask({ type: 'flow/agent-finish' })).toEqual({ done: true });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(await ask({ type: 'flow/agent-reply', waitMs: 10 })).toEqual({ kind: 'waiting' });
    expect(SEL.agentModeOn).toBe('.agent-mode-chip[aria-pressed="true"]');
  });
});

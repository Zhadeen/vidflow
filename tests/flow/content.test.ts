import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEL } from '../../src/flow/selectors';

/** The Flow helper (content script) loaded into jsdom with a minimal chrome; its message listener is captured. */
type OnMessage = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
let onMessage: OnMessage;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/flow/prompt-bar.html'), 'utf8');
  vi.stubGlobal('defineContentScript', (def: { main: () => void }) => def);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'vidflow',
      sendMessage: vi.fn(async () => null), // no run: the pill stays hidden
      onMessage: { addListener: (l: OnMessage) => (onMessage = l) },
    },
    storage: {
      local: { get: vi.fn(async (key: string) => (key === 'expectedAccount' ? { expectedAccount: 'owner@example.com' } : {})) },
      onChanged: { addListener: vi.fn() },
    },
  });
  const script = (await import('../../src/entrypoints/flow.content')).default as unknown as { main: () => void };
  script.main();
});
afterEach(() => {
  vi.unstubAllGlobals();
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

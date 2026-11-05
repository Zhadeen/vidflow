import { describe, expect, it, vi } from 'vitest';
import { E2E_START, handleE2e, registerE2e, senderAllowed } from '../../src/e2e/background';
import { installPageBridge } from '../../src/e2e/page-bridge';

const good = { id: 'ext', tab: { id: 3 }, url: 'https://flow.google.com/project/x' };

describe('e2e hook routing', () => {
  it('registers nothing when the flag is off', () => {
    const addListener = vi.fn();
    expect(registerE2e(false, { addListener }, 'ext')).toBe(false);
    expect(addListener).not.toHaveBeenCalled();
  });

  it('accepts only this extension in a Flow tab', () => {
    expect(senderAllowed(good, 'ext')).toBe(true);
    expect(senderAllowed({ ...good, id: 'other' }, 'ext')).toBe(false);
    expect(senderAllowed({ ...good, tab: undefined }, 'ext')).toBe(false);
    expect(senderAllowed({ ...good, url: 'https://evil.example/' }, 'ext')).toBe(false);
    expect(senderAllowed({ ...good, url: 'chrome-extension://ext/studio.html' }, 'ext')).toBe(false);
  });

  it('answers allowed senders, refuses others, ignores other message types', () => {
    let listener!: (m: { type?: string }, s: unknown, r: (x: unknown) => void) => boolean | undefined;
    const handle = vi.fn().mockResolvedValue({ ok: true, data: 1 });
    registerE2e(true, { addListener: (cb) => (listener = cb as never) }, 'ext', handle);
    const send = vi.fn();
    expect(listener({ type: 'e2e/status' }, good, send)).toBe(true);
    expect(handle).toHaveBeenCalledOnce();
    const refused = vi.fn();
    expect(listener({ type: 'e2e/status' }, { ...good, tab: undefined }, refused)).toBeUndefined();
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(handle).toHaveBeenCalledOnce();
    expect(listener({ type: 'run/get' }, good, send)).toBeUndefined();
  });
});

describe('e2e page bridge', () => {
  it('ignores foreign sources and forwards vidflow-e2e messages', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, data: { n: 1 } });
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installPageBridge(window, send);
    const msg = { type: 'vidflow-e2e', action: 'status' };
    window.dispatchEvent(new MessageEvent('message', { data: msg, source: null }));
    expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { data: msg, source: window }));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith({ type: 'vidflow-e2e-result', action: 'status', ok: true, data: { n: 1 } }, '*');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'e2e/status' });
  });
});

describe('e2e start', () => {
  it('only reads a hero reference given as a data:image/ URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const url of ['https://evil.example/hero.png', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'blob:https://x/1']) {
        const reply = await handleE2e({
          type: E2E_START,
          name: 'Story',
          csv: 'Slide,Timecode,Sentence\n1,00:00 - 00:04,Hi.',
          heroDescription: 'a tall stickman',
          heroReferenceDataUrl: url,
        });
        expect(reply).toEqual({ ok: false, error: 'heroReferenceDataUrl must be a data:image/ URL.' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

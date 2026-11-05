import { describe, expect, it, vi } from 'vitest';
import { FlowBlockedError, FLOW_CONFIRM, FLOW_DETAIL, FLOW_NEW_PROJECT, FLOW_PREPARE, FLOW_TILE_POINT, FLOW_TILES_NOW, FLOW_UPLOAD_REFERENCE, decodeBytes } from '../../src/flow/messages';
import { createFlowPort } from '../../src/flow/port';

function setup(responses: unknown[], zoom = 1) {
  const send = vi.fn(async (_tabId: number, _message: unknown) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const press = vi.fn(async () => undefined);
  const port = createFlowPort({ send, press, wait: async () => undefined, getZoom: async () => zoom });
  return { send, press, port };
}

const notThere = () => new Error('Could not establish connection. Receiving end does not exist.');

describe('Flow port', () => {
  it('asks the Flow tab to prepare and returns where Generate is, without pressing', async () => {
    const { send, press, port } = setup([{ kind: 'ready', x: 120, y: 620 }]);
    const at = await port.prepare(7, 's1', 'A stickman waves', { aspect: '16:9', outputs: 2, verb: 'Resume' });
    expect(at).toEqual({ x: 120, y: 620 });
    expect(send).toHaveBeenCalledWith(7, {
      type: FLOW_PREPARE,
      prompt: 'A stickman waves',
      aspect: '16:9',
      outputs: 2,
      verb: 'Resume',
    });
    expect(press).not.toHaveBeenCalled();
  });

  it('presses at the point, scaled by the tab zoom', async () => {
    const plain = setup([]);
    await plain.port.press(7, 120, 620);
    expect(plain.press).toHaveBeenCalledWith(7, 120, 620);
    const zoomed = setup([], 1.25);
    await zoomed.port.press(7, 100, 200);
    expect(zoomed.press).toHaveBeenCalledWith(7, 125, 250);
  });

  it('turns a blocked page into a FlowBlockedError', async () => {
    const event = { type: 'needsOwner', reason: 'wrong-account', message: 'Switch accounts' } as const;
    const { port } = setup([{ kind: 'blocked', event }]);
    const err = await port.prepare(7, 's1', 'p').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).event).toEqual(event);
  });

  it('throws a plain error when preparing fails', async () => {
    const { port } = setup([{ kind: 'error', message: "Flow's Generate button didn't become ready." }]);
    await expect(port.prepare(7, 's1', 'p')).rejects.toThrow(/Generate/);
  });

  it('asks again when the Flow page reloads mid-request (channel closed)', async () => {
    // Live Flow (5 Nov 2026): right after a new project opens, Flow reloads and the first prepare loses its channel.
    const closed = new Error(
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
    );
    const { send, port } = setup([closed, { kind: 'ready', x: 1, y: 2 }]);
    expect(await port.prepare(7, 's1', 'p')).toEqual({ x: 1, y: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits for the Flow helper to load in a new tab', async () => {
    const { send, port } = setup([notThere(), notThere(), { kind: 'ready', x: 1, y: 2 }]);
    expect(await port.prepare(7, 's1', 'p')).toEqual({ x: 1, y: 2 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('pauses for the owner when the Flow helper never answers', async () => {
    const { port } = setup(Array.from({ length: 30 }, notThere));
    const err = await port.prepare(7, 's1', 'p').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).event).toMatchObject({ type: 'needsOwner', reason: 'page-not-recognised' });
  });

  it('asks for the New project button', async () => {
    const { send, port } = setup([{ kind: 'ready', x: 120, y: 224 }]);
    expect(await port.findNewProject(7, 'Start')).toEqual({ x: 120, y: 224 });
    expect(send).toHaveBeenCalledWith(7, { type: FLOW_NEW_PROJECT, verb: 'Start' });
  });

  it('asks the Flow tab whether the press started a picture', async () => {
    const { send, port } = setup([{ started: true }, { started: false }, undefined]);
    expect(await port.confirmStarted(7)).toBe(true);
    expect(send).toHaveBeenCalledWith(7, { type: FLOW_CONFIRM });
    expect(await port.confirmStarted(7)).toBe(false);
    expect(await port.confirmStarted(7)).toBe(false);
  });

  it('asks for the tiles, a tile to open, and the detail prompt', async () => {
    const card = { key: 'k1', caption: 't', imageUrl: 'u', progress: null, refusal: null, domIndex: 0 };
    const { send, port } = setup([
      { cards: [card] },
      { kind: 'ready', x: 50, y: 60 },
      { kind: 'error', message: 'gone' },
      { prompt: 'A stickman waves', mediaId: 'k1' },
      undefined,
    ]);
    expect(await port.tiles(7)).toEqual([card]);
    expect(await port.tilePoint(7, 'k1')).toEqual({ x: 50, y: 60 });
    await expect(port.tilePoint(7, 'k2')).rejects.toThrow('gone');
    expect(await port.readDetail(7)).toEqual({ prompt: 'A stickman waves', mediaId: 'k1' });
    expect(await port.readDetail(7)).toEqual({ prompt: null, mediaId: null });
    expect(send.mock.calls.map(([, m]) => m)).toEqual([
      { type: FLOW_TILES_NOW },
      { type: FLOW_TILE_POINT, key: 'k1' },
      { type: FLOW_TILE_POINT, key: 'k2' },
      { type: FLOW_DETAIL },
      { type: FLOW_DETAIL },
    ]);
  });

  it("sends the reference picture's bytes to the Flow tab and returns the reference tile's media id", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256); // more than one encoding chunk
    const { send, port } = setup([{ kind: 'done', mediaId: 'ref-media-1' }, { kind: 'done', mediaId: null }]);
    const blob = new Blob([bytes], { type: 'image/webp' });
    expect(await port.uploadReference(7, 'vidflow-hero-3f1c2a9e.webp', blob)).toBe('ref-media-1');
    const [, message] = send.mock.calls[0]! as [number, { type: string; name: string; mimeType: string; data: string }];
    expect(message.type).toBe(FLOW_UPLOAD_REFERENCE);
    expect(message.name).toBe('vidflow-hero-3f1c2a9e.webp');
    expect(message.mimeType).toBe('image/webp');
    expect(decodeBytes(message.data)).toEqual(bytes);
    expect(await port.uploadReference(7, 'x.png', blob)).toBeNull();
  });

  it('turns a blocked or failed upload into a FlowBlockedError or an error', async () => {
    const event = { type: 'needsOwner', reason: 'page-not-recognised', message: 'Check Flow' } as const;
    const { port } = setup([{ kind: 'blocked', event }, { kind: 'error', message: 'gone' }]);
    await expect(port.uploadReference(7, 'x.png', new Blob(['x']))).rejects.toBeInstanceOf(FlowBlockedError);
    await expect(port.uploadReference(7, 'x.png', new Blob(['x']))).rejects.toThrow('gone');
  });

  it('passes the reference to attach with the prepare request', async () => {
    const { send, port } = setup([{ kind: 'ready', x: 1, y: 2 }]);
    await port.prepare(7, 's1', 'p', { verb: 'Resume', reference: { name: 'vidflow-hero-3f1c2a9e.png' } });
    expect(send).toHaveBeenCalledWith(7, { type: FLOW_PREPARE, prompt: 'p', verb: 'Resume', reference: { name: 'vidflow-hero-3f1c2a9e.png' } });
  });
});

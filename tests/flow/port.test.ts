import { describe, expect, it, vi } from 'vitest';
import { FlowBlockedError, FLOW_ACCEPT_NOTICE, FLOW_AGENT_FINISH, FLOW_AGENT_PREPARE, FLOW_AGENT_REPLY, FLOW_CLIP_FILE, FLOW_CREDIT_BALANCE, FLOW_GENERATE_COST, FLOW_PREPARE_CLIP, FLOW_UPLOAD_START_FRAME, FLOW_VIDEO_DETAIL, FLOW_VIDEO_TILES_NOW, FLOW_CONFIRM, FLOW_DETAIL, FLOW_NEW_PROJECT, FLOW_PREPARE, FLOW_TILE_POINT, FLOW_TILES_NOW, FLOW_UPLOAD_REFERENCE, decodeBytes } from '../../src/flow/messages';
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

  it("marks a block caused by Flow's usage notice, and asks the tab to accept it", async () => {
    const event = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' };
    const { send, port } = setup([{ kind: 'blocked', event, notice: true }, { kind: 'blocked', event }, { accepted: true }, undefined]);
    const notice = await port.prepare(7, 's1', 'A stickman waves').catch((e: unknown) => e);
    expect(notice).toBeInstanceOf(FlowBlockedError);
    expect((notice as FlowBlockedError).notice).toBe(true);
    const billing = await port.findNewProject(7, 'Resume').catch((e: unknown) => e);
    expect((billing as FlowBlockedError).notice).toBe(false);
    expect(await port.acceptNotice(7)).toBe(true);
    expect(send).toHaveBeenLastCalledWith(7, { type: FLOW_ACCEPT_NOTICE });
    expect(await port.acceptNotice(7)).toBeNull(); // no answer (e.g. the page reloaded)
  });

  it('carries the notice flag on upload and confirm answers', async () => {
    const event = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' };
    const { port } = setup([{ kind: 'blocked', event, notice: true }, { started: false, notice: true }, { started: true }, { started: false }]);
    const err = await port.uploadReference(7, 'ref.png', new Blob([new Uint8Array([1])], { type: 'image/png' })).catch((e: unknown) => e);
    expect((err as FlowBlockedError).notice).toBe(true);
    expect(await port.confirmStarted(7)).toBe('notice');
    expect(await port.confirmStarted(7)).toBe(true);
    expect(await port.confirmStarted(7)).toBe(false);
  });

  it('a billing dialog after Generate comes back as billing; a notice already gone as gone', async () => {
    const { port } = setup([{ started: false, billing: true }, { accepted: false, gone: true }, { accepted: false }]);
    expect(await port.confirmStarted(7)).toBe('billing');
    expect(await port.acceptNotice(7)).toBe('gone');
    expect(await port.acceptNotice(7)).toBe(false);
  });
});

describe('Flow port: clips and Agent questions', () => {
  it('asks the Flow tab to set up a clip and returns where Generate is, without pressing', async () => {
    const { send, press, port } = setup([{ kind: 'ready', x: 120, y: 620 }]);
    const at = await port.prepareClip(7, 'The stickman waves', { aspect: '16:9', length: 6, startFrame: 'vidflow-s01.png', verb: 'Resume' });
    expect(at).toEqual({ x: 120, y: 620 });
    expect(send).toHaveBeenCalledWith(7, {
      type: FLOW_PREPARE_CLIP,
      prompt: 'The stickman waves',
      aspect: '16:9',
      length: 6,
      startFrame: 'vidflow-s01.png',
      verb: 'Resume',
    });
    expect(press).not.toHaveBeenCalled();
  });

  it("uploads the start frame's bytes; blocks and errors come back as such", async () => {
    const event = { type: 'needsOwner', reason: 'page-not-recognised', message: 'Check Flow' } as const;
    const { send, port } = setup([{ kind: 'done' }, { kind: 'blocked', event }, { kind: 'error', message: 'gone' }]);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await port.uploadStartFrame(7, 'vidflow-s01.png', new Blob([bytes], { type: 'image/png' }));
    const [, message] = send.mock.calls[0]! as [number, { type: string; name: string; mimeType: string; data: string }];
    expect(message).toMatchObject({ type: FLOW_UPLOAD_START_FRAME, name: 'vidflow-s01.png', mimeType: 'image/png' });
    expect(decodeBytes(message.data)).toEqual(bytes);
    await expect(port.uploadStartFrame(7, 'x.png', new Blob(['x']))).rejects.toBeInstanceOf(FlowBlockedError);
    await expect(port.uploadStartFrame(7, 'x.png', new Blob(['x']))).rejects.toThrow('gone');
  });

  it('reads the Generate cost and the credit balance', async () => {
    const event = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' } as const;
    const { send, port } = setup([
      { cost: 7 },
      undefined,
      { kind: 'done', balance: { credits: 1043, resets: '13 Nov at 13:50' } },
      { kind: 'done', balance: null },
      { kind: 'blocked', event },
    ]);
    expect(await port.generateCost(7)).toBe(7);
    expect(await port.generateCost(7)).toBeNull();
    expect(await port.creditBalance(7)).toEqual({ credits: 1043, resets: '13 Nov at 13:50' });
    expect(await port.creditBalance(7)).toBeNull();
    await expect(port.creditBalance(7)).rejects.toBeInstanceOf(FlowBlockedError);
    expect(send.mock.calls.map(([, m]) => (m as { type: string }).type)).toEqual([
      FLOW_GENERATE_COST,
      FLOW_GENERATE_COST,
      FLOW_CREDIT_BALANCE,
      FLOW_CREDIT_BALANCE,
      FLOW_CREDIT_BALANCE,
    ]);
  });

  it("reads video tiles, a clip's page and its file URL", async () => {
    const card = { key: 'video-1', caption: 'Stickman waving', imageUrl: 'u', progress: null, refusal: null, domIndex: 1, video: true };
    const file = { url: 'https://flow-content.google/video/1fc?Expires=1', mediaId: '1fc' };
    const { send, port } = setup([{ cards: [card] }, { prompt: 'p', editId: 'e1' }, undefined, { file }, { file: null }]);
    expect(await port.videoTiles(7)).toEqual([card]);
    expect(await port.readVideoDetail(7)).toEqual({ prompt: 'p', editId: 'e1' });
    expect(await port.readVideoDetail(7)).toEqual({ prompt: null, editId: null });
    expect(await port.clipFile(7, 15_000)).toEqual(file);
    expect(await port.clipFile(7)).toBeNull();
    expect(send.mock.calls.map(([, m]) => m)).toEqual([
      { type: FLOW_VIDEO_TILES_NOW },
      { type: FLOW_VIDEO_DETAIL },
      { type: FLOW_VIDEO_DETAIL },
      { type: FLOW_CLIP_FILE, timeoutMs: 15_000 },
      { type: FLOW_CLIP_FILE, timeoutMs: 20_000 },
    ]);
  });

  it('asks the Agent: prepares, presses send itself, polls for the reply, and always finishes', async () => {
    const { send, press, port } = setup([
      { kind: 'ready', x: 110, y: 610 },
      { kind: 'waiting' },
      { kind: 'reply', text: '2 — the shoulder bag' },
      { done: true },
    ]);
    const reply = await port.askAgent(7, ['a.png', 'b.png'], 'Which one? 1 or 2', 90_000);
    expect(reply).toBe('2 — the shoulder bag');
    expect(press).toHaveBeenCalledWith(7, 110, 610);
    const messages = send.mock.calls.map(([, m]) => m as { type: string; waitMs?: number });
    expect(messages[0]).toEqual({ type: FLOW_AGENT_PREPARE, names: ['a.png', 'b.png'], question: 'Which one? 1 or 2' });
    expect(messages[1]!.type).toBe(FLOW_AGENT_REPLY);
    expect(messages[1]!.waitMs).toBeLessThanOrEqual(10_000);
    expect(messages.at(-1)).toEqual({ type: FLOW_AGENT_FINISH });
  });

  it('gives null when the Agent does not answer in time, and still finishes', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { send, port } = setup([{ kind: 'ready', x: 1, y: 2 }, { kind: 'waiting' }, { kind: 'waiting' }, { done: true }]);
    send.mockImplementation(async (_tab: number, message: unknown) => {
      const m = message as { type: string; waitMs?: number };
      if (m.type === FLOW_AGENT_PREPARE) return { kind: 'ready', x: 1, y: 2 };
      if (m.type === FLOW_AGENT_REPLY) {
        now += m.waitMs!;
        return { kind: 'waiting' };
      }
      return { done: true };
    });
    expect(await port.askAgent(7, ['a.png', 'b.png'], 'q', 25_000)).toBeNull();
    expect(send).toHaveBeenLastCalledWith(7, { type: FLOW_AGENT_FINISH });
    vi.restoreAllMocks();
  });

  it('finishes the Agent when pressing send or reading fails, and passes a block on', async () => {
    const event = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' } as const;
    const failing = setup([{ kind: 'ready', x: 1, y: 2 }, { done: true }]);
    failing.press.mockRejectedValueOnce(new Error('debugger detached'));
    await expect(failing.port.askAgent(7, ['a.png'], 'q', 1_000)).rejects.toThrow('debugger detached');
    expect(failing.send).toHaveBeenLastCalledWith(7, { type: FLOW_AGENT_FINISH });
    const blocked = setup([{ kind: 'ready', x: 1, y: 2 }, { kind: 'blocked', event, notice: true }, { done: true }]);
    const err = await blocked.port.askAgent(7, ['a.png'], 'q', 1_000).catch((e: unknown) => e);
    expect((err as FlowBlockedError).notice).toBe(true);
    expect(blocked.send).toHaveBeenLastCalledWith(7, { type: FLOW_AGENT_FINISH });
  });

  it('a blocked prepare is passed on (the tab already finished the Agent)', async () => {
    const event = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' } as const;
    const { press, port } = setup([{ kind: 'blocked', event }, { done: true }]);
    await expect(port.askAgent(7, ['a.png'], 'q', 1_000)).rejects.toBeInstanceOf(FlowBlockedError);
    expect(press).not.toHaveBeenCalled();
  });

  it('finishAgent answers whether the panel is closed and Agent mode off; never throws', async () => {
    const { port } = setup([{ done: true }, { done: false }, new Error('boom')]);
    expect(await port.finishAgent(7)).toBe(true);
    expect(await port.finishAgent(7)).toBe(false);
    expect(await port.finishAgent(7)).toBe(false);
  });
});

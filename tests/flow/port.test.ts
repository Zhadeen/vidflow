import { describe, expect, it, vi } from 'vitest';
import { FlowBlockedError, FLOW_PREPARE, type PrepareResponse } from '../../src/flow/messages';
import { createFlowPort } from '../../src/flow/port';

function setup(responses: (PrepareResponse | Error)[]) {
  const send = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const press = vi.fn(async () => undefined);
  const port = createFlowPort({ send, press, wait: async () => undefined });
  return { send, press, port };
}

const notThere = () => new Error('Could not establish connection. Receiving end does not exist.');

describe('Flow port', () => {
  it('asks the Flow tab to prepare, then presses Generate at the point it returns', async () => {
    const { send, press, port } = setup([{ kind: 'ready', x: 120, y: 620 }]);
    await port.submit(7, 's1', 'A stickman waves', { aspect: '16:9', outputs: 2 });
    expect(send).toHaveBeenCalledWith(7, { type: FLOW_PREPARE, prompt: 'A stickman waves', aspect: '16:9', outputs: 2 });
    expect(press).toHaveBeenCalledWith(7, 120, 620);
  });

  it('turns a blocked page into a FlowBlockedError and does not press', async () => {
    const event = { type: 'needsOwner', reason: 'wrong-account', message: 'Switch accounts' } as const;
    const { press, port } = setup([{ kind: 'blocked', event }]);
    const err = await port.submit(7, 's1', 'p').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).event).toEqual(event);
    expect(press).not.toHaveBeenCalled();
  });

  it('throws a plain error when preparing fails, without pressing', async () => {
    const { press, port } = setup([{ kind: 'error', message: "Flow's Generate button didn't become ready." }]);
    await expect(port.submit(7, 's1', 'p')).rejects.toThrow(/Generate/);
    expect(press).not.toHaveBeenCalled();
  });

  it('waits for the Flow helper to load in a new tab', async () => {
    const { send, press, port } = setup([notThere(), notThere(), { kind: 'ready', x: 1, y: 2 }]);
    await port.submit(7, 's1', 'p');
    expect(send).toHaveBeenCalledTimes(3);
    expect(press).toHaveBeenCalledWith(7, 1, 2);
  });

  it('pauses for the owner when the Flow helper never answers', async () => {
    const { port } = setup(Array.from({ length: 30 }, notThere));
    const err = await port.submit(7, 's1', 'p').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).event).toMatchObject({ type: 'needsOwner', reason: 'page-not-recognised' });
  });
});

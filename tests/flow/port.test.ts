import { describe, expect, it, vi } from 'vitest';
import { FlowBlockedError, FLOW_CONFIRM, FLOW_NEW_PROJECT, FLOW_PREPARE } from '../../src/flow/messages';
import { createFlowPort } from '../../src/flow/port';

function setup(responses: unknown[], zoom = 1) {
  const send = vi.fn(async () => {
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
});

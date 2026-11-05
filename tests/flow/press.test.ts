import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detachFlowDebugger, pressAt } from '../../src/flow/press';

function mockDebugger(targets: { tabId?: number; attached: boolean }[] = []) {
  const calls: unknown[][] = [];
  const debuggerApi = {
    getTargets: vi.fn(async () => targets),
    attach: vi.fn(async (...args: unknown[]) => void calls.push(['attach', ...args])),
    detach: vi.fn(async (...args: unknown[]) => void calls.push(['detach', ...args])),
    sendCommand: vi.fn(async (...args: unknown[]) => void calls.push(['send', ...args])),
  };
  vi.stubGlobal('chrome', { debugger: debuggerApi });
  return { debuggerApi, calls };
}

beforeEach(() => vi.unstubAllGlobals());

describe('pressAt', () => {
  it('attaches, then moves, presses and releases the left button at the point', async () => {
    const { calls } = mockDebugger();
    await pressAt(7, 120, 620);
    const at = { x: 120, y: 620 };
    expect(calls).toEqual([
      ['attach', { tabId: 7 }, '1.3'],
      ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...at }],
      ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 }],
      ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 }],
    ]);
  });

  it('carries on when VidFlow is already attached to that tab', async () => {
    const { debuggerApi } = mockDebugger();
    debuggerApi.attach.mockRejectedValueOnce(new Error('Another debugger is already attached to the tab with id: 7.'));
    await pressAt(7, 1, 2);
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(3);
  });

  it('does not re-attach and retry on its own when a command fails', async () => {
    const { debuggerApi } = mockDebugger();
    debuggerApi.sendCommand.mockRejectedValueOnce(new Error('Debugger is not attached to the tab with id: 7.'));
    await expect(pressAt(7, 1, 2)).rejects.toThrow(/not attached/);
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(1);
  });
});

describe('detachFlowDebugger', () => {
  it('detaches from the tab and ignores "not attached"', async () => {
    const { debuggerApi } = mockDebugger();
    debuggerApi.detach.mockRejectedValueOnce(new Error('Debugger is not attached to the tab with id: 7.'));
    await expect(detachFlowDebugger(7)).resolves.toBeUndefined();
    expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 7 });
  });
});

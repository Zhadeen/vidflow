import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';
import type { FlowPort } from '../../src/runs/coordinator';

const PROJECT_URL = 'https://flow.google.com/u/0/project/3f1c2a9e-1111-4222-8333-944455556666';

/** In-memory chrome APIs the coordinator touches. The Flow tab starts on Flow's home page. */
function mockChrome() {
  const area = () => {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, items)),
      remove: vi.fn(async (key: string) => void delete data[key]),
    };
  };
  const listener = () => ({ addListener: vi.fn() });
  const tab = { id: 7, windowId: 3, url: 'https://flow.google.com/' };
  const chromeMock = {
    tab,
    storage: { local: area(), session: area() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), onAlarm: listener() },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
    notifications: { create: vi.fn(async () => '') },
    windows: { create: vi.fn(async () => ({ id: 3, tabs: [{ id: 7 }] })), onRemoved: listener() },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      update: vi.fn(async (_id: number, props: { url: string }) => void (tab.url = props.url)),
      setZoom: vi.fn(async () => undefined),
      getZoom: vi.fn(async () => 1),
    },
    runtime: { onStartup: listener() },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

async function setup() {
  vi.resetModules();
  const chromeMock = mockChrome();
  const store = await import('../../src/store/projects');
  store.setMediaStore(memoryMediaStore());
  const coordinator = await import('../../src/runs/coordinator');
  // Same module instances as the coordinator's, so instanceof holds after resetModules.
  const { FlowBlockedError } = await import('../../src/flow/messages');
  const { createFlowPort } = await import('../../src/flow/port');
  const { pressAt } = await import('../../src/flow/press');
  coordinator.registerCoordinator();
  const project = await store.createProject('Demo');
  project.aspect = '9:16';
  project.outputsPerPrompt = 4;
  project.scenes = [
    {
      id: 's1',
      slide: 1,
      start: null,
      end: null,
      sentence: 'Hello.',
      concept: 'greeting',
      textOverlay: '',
      imagePrompt: 'A stickman waves',
      motionPrompt: 'The stickman waves',
      motionPromptIsDefault: false,
    },
  ];
  await store.saveProject(project);

  /** A port whose New-project press makes the tab land on a new project. */
  const fakePort = (over: Partial<FlowPort> = {}) => ({
    findNewProject: vi.fn(async () => ({ x: 5, y: 5 })),
    prepare: vi.fn(async () => ({ x: 120, y: 620 })),
    press: vi.fn(async (_tabId: number, x: number) => {
      if (x === 5) chromeMock.tab.url = PROJECT_URL;
    }),
    confirmStarted: vi.fn(async () => true),
    ...over,
  });
  return { chromeMock, coordinator, project, FlowBlockedError, createFlowPort, pressAt, fakePort };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

beforeEach(() => vi.unstubAllGlobals());

describe('coordinator ↔ Flow port', () => {
  it('a new run opens a new Flow project, then prepares, presses, confirms and marks the scene submitted', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');

    expect(port.findNewProject).toHaveBeenCalledWith(7, 'Resume');
    expect(port.prepare).toHaveBeenCalledWith(7, 's1', expect.any(String), { aspect: '9:16', outputs: 4, verb: 'Resume' });
    expect(vi.mocked(port.press).mock.calls).toEqual([
      [7, 5, 5],
      [7, 120, 620],
    ]);
    expect(port.confirmStarted).toHaveBeenCalledWith(7);
    expect(coordinator.getRunState()!.flowProjectUrl).toBe(PROJECT_URL);
    expect(chromeMock.tabs.setZoom).toHaveBeenCalledWith(7, 1);
  });

  it('pauses (scene still queued) when Flow is blocked', async () => {
    const { chromeMock, coordinator, project, FlowBlockedError, fakePort } = await setup();
    const port = fakePort({
      prepare: vi.fn(async () => {
        throw new FlowBlockedError({ type: 'needsOwner', reason: 'wrong-account', message: 'Switch Flow, then press Resume.' });
      }),
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused');
    const state = coordinator.getRunState()!;
    expect(state.pauseReason).toBe('Switch Flow, then press Resume.');
    expect(state.sceneStates.s1?.status).toBe('pending');
    expect(port.press).toHaveBeenCalledTimes(1); // only New project
    expect(chromeMock.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it('does not press Generate when the owner pauses while the prompt is being prepared', async () => {
    const { chromeMock, coordinator, project, createFlowPort, pressAt } = await setup();
    const send = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === 'flow/new-project') return { kind: 'ready', x: 5, y: 5 };
      if (message.type === 'flow/prepare') {
        await coordinator.pauseRun(); // the owner presses Pause mid-prepare
        return { kind: 'ready', x: 120, y: 620 };
      }
      return { started: true };
    });
    const press = vi.fn(async (tabId: number, x: number, y: number) => {
      await pressAt(tabId, x, y);
      if (x === 5) chromeMock.tab.url = PROJECT_URL;
    });
    coordinator.setFlowPort(createFlowPort({ send, press, wait: async () => undefined, getZoom: async () => 1 }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused' && send.mock.calls.length >= 2);
    await new Promise((r) => setTimeout(r, 30));

    const presses = chromeMock.debugger.sendCommand.mock.calls as unknown as [unknown, string, { x: number }][];
    expect(presses.every(([, , params]) => params.x === 5)).toBe(true); // nothing at Generate
    expect(send.mock.calls.some(([, m]) => m.type === 'flow/confirm')).toBe(false);
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    const lastAttach = Math.max(...chromeMock.debugger.attach.mock.invocationCallOrder);
    const lastDetach = Math.max(...chromeMock.debugger.detach.mock.invocationCallOrder);
    expect(lastDetach).toBeGreaterThan(lastAttach); // the debugger is not left attached
  });

  it('pauses when Flow does not start after the press', async () => {
    const { coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(async () => false) }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused');
    const state = coordinator.getRunState()!;
    expect(state.pauseReason).toBe("VidFlow pressed Generate but Flow didn't start. Check the Flow window, then press Resume.");
    expect(state.sceneStates.s1?.status).toBe('pending');
  });

  it('marks the scene failed for an ordinary error', async () => {
    const { coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort({ prepare: vi.fn(async () => Promise.reject(new Error('nope'))) }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'finished');
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('failed');
  });

  it('ignores page-level events when no run is going', async () => {
    const { coordinator } = await setup();
    await coordinator.handleFlowEvent({ type: 'limit', message: 'quota', resumeAt: null });
    expect(coordinator.getRunState()).toBeNull();
  });

  it('only treats its own Flow tab as the Flow tab', async () => {
    const { chromeMock, coordinator } = await setup();
    chromeMock.storage.local.data['vidflow.flowWindow'] = { windowId: 3, tabId: 7 };
    expect(await coordinator.isFlowTab(7)).toBe(true);
    expect(await coordinator.isFlowTab(8)).toBe(false);
    expect(await coordinator.isFlowTab(undefined)).toBe(false);
  });
});

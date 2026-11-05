import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';

/** In-memory chrome APIs the coordinator touches. */
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
  const chromeMock = {
    storage: { local: area(), session: area() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), onAlarm: listener() },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
    notifications: { create: vi.fn(async () => '') },
    windows: { create: vi.fn(async () => ({ id: 3, tabs: [{ id: 7 }] })), onRemoved: listener() },
    tabs: { get: vi.fn(async () => ({ id: 7, windowId: 3, url: 'https://flow.google.com/' })) },
    runtime: { onStartup: listener() },
    debugger: { detach: vi.fn(async () => undefined) },
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
  // Same module instance as the coordinator's, so instanceof holds after resetModules.
  const { FlowBlockedError } = await import('../../src/flow/messages');
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
  return { chromeMock, coordinator, project, FlowBlockedError };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

beforeEach(() => vi.unstubAllGlobals());

describe('coordinator ↔ Flow port', () => {
  it('passes the aspect and outputs, and pauses (scene still queued) when Flow is blocked', async () => {
    const { chromeMock, coordinator, project, FlowBlockedError } = await setup();
    const submit = vi.fn(async () => {
      throw new FlowBlockedError({ type: 'needsOwner', reason: 'wrong-account', message: 'Switch Flow, then press Start again.' });
    });
    coordinator.setFlowPort({ submit });
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused');

    expect(submit).toHaveBeenCalledWith(7, 's1', expect.any(String), { aspect: '9:16', outputs: 4 });
    const state = coordinator.getRunState()!;
    expect(state.pauseReason).toBe('Switch Flow, then press Start again.');
    expect(state.sceneStates.s1?.status).toBe('pending');
    expect(chromeMock.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it('marks the scene failed for an ordinary error', async () => {
    const { coordinator, project } = await setup();
    coordinator.setFlowPort({ submit: vi.fn(async () => Promise.reject(new Error('nope'))) });
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

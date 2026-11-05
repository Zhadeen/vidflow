import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';
import type { FlowResultCard } from '../../src/flow/driver';
import type { FlowPort } from '../../src/runs/coordinator';
import { fakeDownloads } from '../files/fakeDownloads';

const TILE_X = 50;
/** A finished result tile, newest first by domIndex. */
const card = (key: string, domIndex: number): FlowResultCard => ({
  key,
  caption: `Stickman title ${key}`,
  imageUrl: `https://flow-content.google/image/${key}`,
  progress: null,
  refusal: null,
  domIndex,
});

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
  const tab = { id: 7, windowId: 3, url: 'https://flow.google.com/', active: true };
  const chromeMock = {
    tab,
    storage: { local: area(), session: area(), onChanged: listener() },
    alarms: { create: vi.fn(async (_name: string, _info: unknown) => undefined), clear: vi.fn(async () => true), onAlarm: listener() },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
    notifications: { create: vi.fn(async () => '') },
    downloads: fakeDownloads().api,
    windows: { create: vi.fn(async () => ({ id: 3, tabs: [{ id: 7 }] })), update: vi.fn(async () => undefined), onRemoved: listener() },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      update: vi.fn(async (_id: number, props: { url?: string; active?: boolean }) => {
        if (props.url !== undefined) tab.url = props.url;
        if (props.active !== undefined) tab.active = props.active;
      }),
      goBack: vi.fn(async () => void (tab.url = tab.url.replace(/\/edit\/.*$/, ''))),
      setZoomSettings: vi.fn(async () => undefined),
      setZoom: vi.fn(async () => undefined),
      getZoom: vi.fn(async () => 1),
    },
    runtime: { onStartup: listener(), getURL: (p: string) => `chrome-extension://test/${p}` },
    debugger: {
      attach: vi.fn(async (_target: unknown) => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

/** Short pauses between scenes and URL polls, so tests don't wait out the real pacing. */
const FAST = { paceMinMs: 1, paceMaxMs: 2, urlPollMs: 5, backWaitMs: 200 };

async function setup(outputs: 1 | 2 | 4 = 4) {
  vi.resetModules();
  const chromeMock = mockChrome();
  const store = await import('../../src/store/projects');
  const media = memoryMediaStore();
  store.setMediaStore(media);
  const coordinator = await loadCoordinator();
  // Same module instances as the coordinator's, so instanceof holds after resetModules.
  const { FlowBlockedError } = await import('../../src/flow/messages');
  const { createFlowPort } = await import('../../src/flow/port');
  const { pressAt } = await import('../../src/flow/press');
  coordinator.registerCoordinator();
  const project = await store.createProject('Demo');
  project.aspect = '9:16';
  project.outputsPerPrompt = outputs;
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
      if (x === TILE_X) chromeMock.tab.url = `${PROJECT_URL}/edit/generation-1`; // a tile opens its detail page
    }),
    confirmStarted: vi.fn(async (): Promise<boolean | 'notice'> => true),
    tiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    tilePoint: vi.fn(async () => ({ x: TILE_X, y: 300 })),
    readDetail: vi.fn(async () => ({ prompt: null as string | null, mediaId: null as string | null })),
    uploadReference: vi.fn(async (_tabId: number, _name: string, _image: Blob): Promise<string | null> => 'ref-media-1'),
    acceptNotice: vi.fn(async (_tabId: number): Promise<boolean | null> => true),
    ...over,
  });
  return { chromeMock, coordinator, project, media, FlowBlockedError, createFlowPort, pressAt, fakePort };
}

/** Polls until `check` holds; throws with `what` after 5 s. */
async function waitFor(check: () => boolean, what = 'the expected state') {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after 5 s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The listener the coordinator registered on a mocked chrome event. */
function listenerOf<T extends (...args: never[]) => unknown>(event: { addListener: { mock: { calls: unknown[][] } } }): T {
  const calls = event.addListener.mock.calls;
  return calls[calls.length - 1]![0] as T;
}

/** Every coordinator a test loaded; each is stopped afterwards so it can't act on the next test's chrome. */
const live: (typeof import('../../src/runs/coordinator'))[] = [];
async function loadCoordinator() {
  const coordinator = await import('../../src/runs/coordinator');
  coordinator.setTimingsForTests(FAST);
  live.push(coordinator);
  return coordinator;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(async () => {
  for (const c of live.splice(0)) await c.stopRun().catch(() => undefined);
});

describe('coordinator ↔ Flow port', () => {
  it("before every press, VidFlow's tab is made the active tab of its own window (never focusing the window)", async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    const activeAtPress: boolean[] = [];
    const base = fakePort();
    const port = fakePort({
      press: vi.fn(async (tabId: number, x: number, y: number) => {
        activeAtPress.push(chromeMock.tab.active);
        chromeMock.tab.active = false; // the owner switched to another tab in that window meanwhile
        await base.press(tabId, x, y);
      }),
    });
    chromeMock.tab.active = false; // another tab is in front in VidFlow's window
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    expect(activeAtPress).toEqual([true, true]); // New project, then Generate
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chromeMock.windows.update).not.toHaveBeenCalled();
  });

  it('does not re-activate a tab that is already active before a press', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    expect(chromeMock.tabs.update.mock.calls.filter(([, p]) => 'active' in (p as object))).toEqual([]);
  });

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
    // Per-tab first, so the owner's other Flow tabs keep their own zoom.
    expect(chromeMock.tabs.setZoomSettings).toHaveBeenCalledWith(7, expect.objectContaining({ scope: 'per-tab' }));
    expect(chromeMock.tabs.setZoomSettings.mock.invocationCallOrder[0]!).toBeLessThan(chromeMock.tabs.setZoom.mock.invocationCallOrder[0]!);
  });

  it("leaves the zoom alone when it can't be made per-tab", async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    chromeMock.tabs.setZoomSettings.mockRejectedValue(new Error('no'));
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    expect(chromeMock.tabs.setZoom).not.toHaveBeenCalled();
  });

  it('pauses and says so when the owner closes VidFlow\'s Flow window; Resume opens a new one', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    expect(chromeMock.windows.create).toHaveBeenCalledTimes(1);
    await listenerOf<(id: number) => Promise<void>>(chromeMock.windows.onRemoved)(3);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    expect(coordinator.getRunState()!.pauseReason).toBe("VidFlow's Flow window was closed. Press Resume to open it again.");
    expect(chromeMock.storage.local.data['vidflow.flowWindow']).toBeUndefined();
    expect(chromeMock.windows.create).toHaveBeenCalledTimes(1); // not silently reopened
    await coordinator.resumeRun();
    await waitFor(() => chromeMock.windows.create.mock.calls.length === 2, 'a new Flow window');
    expect(coordinator.getRunState()!.status).toBe('running');
  });

  it('Resume with scenes both waiting and in Flow opens only one new window', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    saved.scenes = [...saved.scenes, { ...saved.scenes[0]!, id: 's2', slide: 2, imagePrompt: 'A stickman sits' }];
    await store.saveProject(saved);
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    const port = fakePort();
    vi.mocked(port.prepare).mockImplementation(async (_tab, sceneId) => {
      if (sceneId === 's2' && vi.mocked(port.prepare).mock.calls.length === 2) await gate; // s2 is being typed…
      return { x: 120, y: 620 };
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => vi.mocked(port.prepare).mock.calls.length === 2, 's2 being prepared');
    await listenerOf<(id: number) => Promise<void>>(chromeMock.windows.onRemoved)(3); // …when the window is closed
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    release();
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s2?.status).toBe('pending');
    chromeMock.windows.create.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // Chrome takes a moment to open it
      return { id: 3, tabs: [{ id: 7 }] };
    });
    await coordinator.resumeRun();
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 's2 submitted');
    expect(chromeMock.windows.create).toHaveBeenCalledTimes(2); // the first window, and one new one
  });

  it('closing some other window changes nothing', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await listenerOf<(id: number) => Promise<void>>(chromeMock.windows.onRemoved)(99);
    expect(coordinator.getRunState()!.status).toBe('running');
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
    // commit() sets the state before it detaches, so wait for both.
    await waitFor(() => coordinator.getRunState()?.status === 'paused' && chromeMock.debugger.detach.mock.calls.length > 0);
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
    const detachedAfterAttach = () =>
      Math.max(0, ...chromeMock.debugger.detach.mock.invocationCallOrder) >
      Math.max(0, ...chromeMock.debugger.attach.mock.invocationCallOrder);
    await waitFor(detachedAfterAttach);
    await coordinator.settledForTests(); // a wrongly-unguarded press would have happened by now

    const presses = chromeMock.debugger.sendCommand.mock.calls as unknown as [unknown, string, { x: number }][];
    expect(presses.every(([, , params]) => params.x === 5)).toBe(true); // nothing at Generate
    expect(send.mock.calls.some(([, m]) => m.type === 'flow/confirm')).toBe(false);
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    expect(detachedAfterAttach()).toBe(true); // the debugger is not left attached
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

  it("answers another tab's pill request without reading the step or the project", async () => {
    const { chromeMock, coordinator } = await setup();
    chromeMock.storage.local.data['vidflow.flowWindow'] = { windowId: 3, tabId: 7 };
    chromeMock.storage.local.get.mockClear();
    expect(await coordinator.pillFor(8)).toBeNull();
    const keys = chromeMock.storage.local.get.mock.calls.map((c) => c[0]);
    expect(keys).not.toContain('vidflow.step');
  });

});

describe('studio controls', () => {
  it('tells listeners about every state change', async () => {
    const { coordinator, project, fakePort } = await setup();
    const seen: string[] = [];
    coordinator.onRunState((s) => seen.push(s.status));
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => seen.includes('running'));
  });

  it('will not start a second project while another is making pictures', async () => {
    const { coordinator, project, fakePort } = await setup();
    const store = await import('../../src/store/projects');
    const other = await store.createProject('Other');
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startRun(project.id);
    await expect(coordinator.startRun(other.id)).rejects.toThrow(coordinator.BUSY_MESSAGE);
  });

  it('Try again re-queues a refused scene of the current run', async () => {
    const { coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await coordinator.handleFlowEvent({ type: 'refused', sceneId: 's1', message: 'Flow refused it.' });
    await waitFor(() => coordinator.getRunState()?.status === 'finished');
    await coordinator.retryScene(project.id, 's1');
    // Back in the queue of a running run; the pump sends it after its usual pause between scenes.
    const state = coordinator.getRunState()!;
    expect(state.status).toBe('running');
    expect(state.sceneStates.s1).toMatchObject({ status: 'pending' });
    expect(state.sceneStates.s1?.message).toBeUndefined();
  });

  it('Try again on a project with no run starts one for that scene', async () => {
    const { coordinator, project, fakePort } = await setup();
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    saved.sceneStates = { s1: { sceneId: 's1', status: 'refused', message: 'no', pictureIds: [] } };
    await store.saveProject(saved);
    coordinator.setFlowPort(fakePort());
    await coordinator.retryScene(project.id, 's1');
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
  });
});

describe('studio controls: fix round', () => {
  /** A paused run on project A (scene still to make), plus project B. */
  async function pausedA() {
    const ctx = await setup();
    const store = await import('../../src/store/projects');
    const b = await store.createProject('Project B');
    b.scenes = ctx.project.scenes;
    await store.saveProject(b);
    ctx.coordinator.setFlowPort(ctx.fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await ctx.coordinator.startRun(ctx.project.id);
    await ctx.coordinator.pauseRun();
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused');
    return { ...ctx, b, store };
  }

  it("refuses to start another project while one is paused with pictures still to make, leaving it untouched", async () => {
    const { coordinator, b } = await pausedA();
    const before = structuredClone(coordinator.getRunState());
    await expect(coordinator.startRun(b.id)).rejects.toThrow(
      '\u201cDemo\u201d is paused with pictures still to make. Resume it or stop it first, then start this one.',
    );
    await expect(coordinator.retryScene(b.id, 's1')).rejects.toThrow('is paused with pictures still to make');
    expect(coordinator.getRunState()).toEqual(before);
  });

  it('Stop ends a paused run without deleting pictures, so another project can start', async () => {
    const { coordinator, chromeMock, b, project, store } = await pausedA();
    await coordinator.stopRun();
    const stopped = coordinator.getRunState()!;
    expect(stopped.status).toBe('idle');
    expect(stopped.inFlight).toEqual([]);
    expect(chromeMock.alarms.clear).toHaveBeenCalled();
    expect((await store.getProject(project.id))!.sceneStates.s1?.status).toBe('pending');
    await coordinator.startRun(b.id);
    expect(coordinator.getRunState()?.projectId).toBe(b.id);
  });

  it('starting the project that is already running changes nothing', async () => {
    const { coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(async () => true) }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    const before = structuredClone(coordinator.getRunState());
    await coordinator.startRun(project.id);
    expect(coordinator.getRunState()).toEqual(before);
  });

  it("discards a finished run when its project's scenes are replaced", async () => {
    const { coordinator, chromeMock, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await coordinator.handleFlowEvent({ type: 'refused', sceneId: 's1', message: 'No.' });
    await waitFor(() => coordinator.getRunState()?.status === 'finished');
    await coordinator.discardFinishedRun(project.id);
    expect(coordinator.getRunState()).toBeNull();
    expect(chromeMock.storage.local.data['vidflow.run']).toBeUndefined();
  });

  it('keeps a live run when asked to discard it', async () => {
    const { coordinator } = await pausedA();
    await coordinator.discardFinishedRun(coordinator.getRunState()!.projectId);
    expect(coordinator.getRunState()?.status).toBe('paused');
  });
});

describe('matching results to scenes', () => {
  /** Starts a run of one scene and waits until Flow has it; returns the exact prompt VidFlow typed. */
  async function submitted(outputs: 1 | 2 | 4, over: Partial<FlowPort> = {}) {
    const ctx = await setup(outputs);
    const port = ctx.fakePort(over);
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    return { ...ctx, port, prompt };
  }

  function stubFetch() {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('a tile press is preceded by making the tab active', async () => {
    const { chromeMock, coordinator, port } = await submitted(1);
    vi.mocked(port.press).mockClear();
    chromeMock.tab.active = false;
    let activeAtTilePress: boolean | undefined;
    const inner = vi.mocked(port.press).getMockImplementation()!;
    vi.mocked(port.press).mockImplementation(async (tabId, x, y) => {
      if (x === TILE_X) activeAtTilePress = chromeMock.tab.active;
      await inner(tabId, x, y);
    });
    vi.mocked(port.readDetail).mockResolvedValue({ prompt: null, mediaId: 'k1' });
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => vi.mocked(port.readDetail).mock.calls.length >= 1);
    await coordinator.settledForTests();
    expect(activeAtTilePress).toBe(true);
    expect(chromeMock.windows.update).not.toHaveBeenCalled();
  });

  it("saves a scene's pictures only after each card's detail prompt verifies", async () => {
    const { chromeMock, coordinator, port, prompt, media, project } = await submitted(2);
    const fetchMock = stubFetch();
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ({ x: TILE_X, y: key === 'k1' ? 1 : 2 }));
    let opened = '';
    vi.mocked(port.press).mockImplementation(async (_tab, x, y) => {
      if (x === TILE_X) {
        opened = y === 1 ? 'k1' : 'k2';
        chromeMock.tab.url = `${PROJECT_URL}/edit/gen-${opened}`;
      }
    });
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt: `  ${prompt.toUpperCase()} `, mediaId: opened }));

    await coordinator.handleTiles([card('k2', 0), card('k1', 1)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done');

    const scene = coordinator.getRunState()!.sceneStates.s1!;
    expect(scene.pictureIds).toEqual([`${project.id}/scene-01-option-1`, `${project.id}/scene-01-option-2`]);
    expect(scene.cardKeys).toEqual(['k1', 'k2']);
    expect(scene.chosenPictureId).toBeUndefined();
    expect(await (await media.get(`${project.id}/scene-01-option-1`))!.text()).toBe('png:https://flow-content.google/image/k1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(port.readDetail).toHaveBeenCalledTimes(2);
    expect(chromeMock.tab.url).toBe(PROJECT_URL); // back on the project after each detail
  });

  it('auto-save runs after a scene is saved only when the switch is on', async () => {
    for (const on of [false, true]) {
      const { chromeMock, coordinator, port, prompt, project } = await submitted(2);
      if (on) chromeMock.storage.local.data['vidflow.autoSave'] = true;
      stubFetch();
      let opened = '';
      vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
      vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: opened }));
      await coordinator.handleTiles([card('k2', 0), card('k1', 1)]);
      await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 done');
      await coordinator.settledForTests();
      if (!on) {
        expect(chromeMock.downloads.download).not.toHaveBeenCalled();
        continue;
      }
      await waitFor(() => chromeMock.downloads.download.mock.calls.length === 1, 'the auto-save download');
      // Straight from the signed Flow address the picture was verified at (a data: URL can't carry a 4 MB PNG).
      expect(chromeMock.downloads.download.mock.calls[0]![0]).toEqual({
        url: 'https://flow-content.google/image/k1',
        filename: 'Demo/Slide_01.png',
        conflictAction: 'uniquify',
        saveAs: false,
      });
      const store = await import('../../src/store/projects');
      let downloaded: Record<string, string> | undefined;
      for (let i = 0; i < 200 && !downloaded; i++) {
        downloaded = (await store.getProject(project.id))!.downloaded;
        if (!downloaded) await new Promise((r) => setTimeout(r, 5));
      }
      expect(downloaded).toEqual({ [`${project.id}/scene-01-option-1`]: 'Slide_01.png' });
    }
  });

  it("a download mark written while the run commits is never lost", async () => {
    const { coordinator, project } = await submitted(1);
    const store = await import('../../src/store/projects');
    // Each mark lands a little later into a commit (0–39 turns of the event loop), so some fall between its read and write.
    const marks: string[] = [];
    for (let i = 0; i < 40; i++) {
      const later = async () => {
        for (let k = 0; k < i; k++) await Promise.resolve();
        await store.updateProject(project.id, (v) => void (v.downloaded = { ...v.downloaded, [`m${i}`]: `f${i}.png` }));
      };
      marks.push(`m${i}`);
      await Promise.all([i % 2 ? coordinator.resumeRun() : coordinator.pauseRun(), later()]);
    }
    await coordinator.settledForTests();
    expect(Object.keys((await store.getProject(project.id))!.downloaded ?? {}).sort()).toEqual(marks.sort());
  });

  it('a failing auto-save never fails the scene or the run', async () => {
    const { chromeMock, coordinator, port, prompt, project } = await submitted(1);
    chromeMock.storage.local.data['vidflow.autoSave'] = true;
    chromeMock.downloads.download.mockRejectedValue(new Error('Download failed'));
    stubFetch();
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: 'k1' }));
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 done');
    const texts = () =>
      ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as { projectId: string; text: string }[])
        .filter((e) => e.projectId === project.id)
        .map((e) => e.text);
    await waitFor(() => texts().includes("Couldn't save scene 1 to your Mac"), 'the auto-save problem line');
    expect(coordinator.getRunState()!.sceneStates.s1!.status).toBe('done');
  });

  it('never saves a card whose detail prompt differs, and fails the scene when the detail stays unreadable', async () => {
    const { coordinator, port } = await submitted(1);
    const fetchMock = stubFetch();
    vi.mocked(port.readDetail).mockResolvedValueOnce({ prompt: 'A stickman reads a book', mediaId: 'other' });
    await coordinator.handleTiles([card('other', 0)]);
    await waitFor(() => coordinator.getRunState()?.detailPrompts?.other !== undefined);
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted'); // still waiting for its own picture
    expect(fetchMock).not.toHaveBeenCalled();

    vi.mocked(port.readDetail).mockResolvedValue({ prompt: null, mediaId: 'k1' });
    await coordinator.handleTiles([card('k1', 0), card('other', 1)]);
    await waitFor(() => vi.mocked(port.readDetail).mock.calls.length === 2);
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted'); // one unreadable read: try again later
    await coordinator.handleTiles([card('k1', 0), card('other', 1)]); // the next report: still unreadable
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'failed');
    expect(coordinator.getRunState()!.sceneStates.s1?.message).toBe(
      "VidFlow couldn't confirm which picture belongs to this scene. Press Try again.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trusts a detail prompt only when the page's picture is that card", async () => {
    const { coordinator, port, prompt, chromeMock } = await submitted(1);
    const fetchMock = stubFetch();
    vi.mocked(port.readDetail).mockResolvedValue({ prompt, mediaId: null }); // right prompt, but whose picture?
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => vi.mocked(port.readDetail).mock.calls.length >= 1);
    await coordinator.settledForTests();
    expect(port.readDetail).toHaveBeenCalledTimes(1); // one read per tile report, however often matching runs
    expect(fetchMock).not.toHaveBeenCalled();
    expect(coordinator.getRunState()!.detailPrompts?.k1).toBeUndefined(); // not recorded as verified
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');
    expect(chromeMock.tabs.goBack).toHaveBeenCalledWith(7); // back to the grid without a reload
    expect(chromeMock.tab.url).toBe(PROJECT_URL);
  });

  it('a single partial tile report does not fail a scene; a persistent one does', async () => {
    const { coordinator, port, prompt } = await submitted(1);
    const fetchMock = stubFetch();
    // A refused tile for some other prompt where s1's picture should be: no consistent assignment in this report.
    const foreign: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, caption: 'A stickman in a fight', refusal: 'Might violate' };
    await coordinator.handleTiles([foreign]);
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');

    // The next report is complete: s1's own picture arrives and is saved.
    vi.mocked(port.readDetail).mockResolvedValue({ prompt, mediaId: 'k1' });
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails a scene whose tiles stay inconsistent over two reports', async () => {
    const { coordinator } = await submitted(1);
    const foreign: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, caption: 'A stickman in a fight', refusal: 'Might violate' };
    await coordinator.handleTiles([foreign]);
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');
    await coordinator.handleTiles([foreign, { ...foreign, key: 'pending-1', domIndex: 1 }]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'failed');
    expect(coordinator.getRunState()!.sceneStates.s1).toMatchObject({
      status: 'failed',
      message: "VidFlow couldn't confirm which picture belongs to this scene. Press Try again.",
    });
  });

  it('records an unconfirmed start with the tiles seen just before the press', async () => {
    const { coordinator, project, fakePort } = await setup(2);
    const port = fakePort({ confirmStarted: vi.fn(async () => false), tiles: vi.fn(async () => [card('old', 0)]) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused');
    const scene = coordinator.getRunState()!.sceneStates.s1!;
    expect(scene.status).toBe('pending');
    expect(scene.unconfirmed).toEqual({ keysBefore: ['old'], prompt: vi.mocked(port.prepare).mock.calls[0]![2], at: expect.any(Number) });
  });

  async function unconfirmedThenResume(newTiles: FlowResultCard[], detail: (key: string) => string | null) {
    const ctx = await setup(2);
    const port = ctx.fakePort({ confirmStarted: vi.fn(async () => false), tiles: vi.fn(async () => [card('old', 0)]) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt: detail(opened) === 'PROMPT' ? prompt : detail(opened), mediaId: opened }));
    vi.mocked(port.tiles).mockResolvedValue([...newTiles, card('old', newTiles.length)]);
    vi.mocked(port.confirmStarted).mockResolvedValue(true);
    const generatePresses = () => vi.mocked(port.press).mock.calls.filter(([, x]) => x === 120).length;
    expect(generatePresses()).toBe(1);
    await ctx.coordinator.resumeRun();
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    return { ...ctx, port, prompt, generatePresses };
  }

  it('on Resume, treats an unconfirmed scene as submitted when a new tile verifies against its prompt', async () => {
    const { coordinator, port, generatePresses } = await unconfirmedThenResume([card('n2', 0), card('n1', 1)], () => 'PROMPT');
    expect(generatePresses()).toBe(1); // not pressed again: no surplus batch
    expect(port.prepare).toHaveBeenCalledTimes(1);
    expect(coordinator.getRunState()!.sceneStates.s1?.unconfirmed).toBeUndefined();
    expect(coordinator.getRunState()!.detailPrompts?.n1).toBeDefined();
  });

  it('on Resume, waits for a still-generating tile with its prompt instead of declaring it submitted or pressing', async () => {
    const ctx = await setup(2);
    const port = ctx.fakePort({ confirmStarted: vi.fn(async () => false), tiles: vi.fn(async () => [card('old', 0)]) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    const generating: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, progress: 40, caption: prompt };
    vi.mocked(port.tiles).mockResolvedValue([generating, card('old', 1)]);
    await ctx.coordinator.resumeRun();
    const before = vi.mocked(port.tiles).mock.calls.length;
    await waitFor(() => vi.mocked(port.tiles).mock.calls.length >= before + 4, 'several looks at the tiles'); // several pump rounds
    expect(ctx.coordinator.getRunState()!.sceneStates.s1).toMatchObject({ status: 'pending' });
    expect(port.prepare).toHaveBeenCalledTimes(1); // not pressed again
    await ctx.coordinator.pauseRun(); // stop this run's pump looking again, so it can't touch the next test's chrome
  });

  it("on Resume, presses again when no new tile is the scene's", async () => {
    const { port, generatePresses } = await unconfirmedThenResume([card('n1', 0)], () => 'A stickman reads a book');
    expect(generatePresses()).toBe(2);
    expect(port.prepare).toHaveBeenCalledTimes(2);
  });
});

describe('final review fixes', () => {
  async function submitted(outputs: 1 | 2 | 4, over: Partial<FlowPort> = {}) {
    const ctx = await setup(outputs);
    const port = ctx.fakePort(over);
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await ctx.coordinator.settledForTests(); // the state is set before commit() finishes (alarms, listeners)
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    return { ...ctx, port, prompt };
  }

  function stubFetch() {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  /** readDetail answers with `prompt` for whichever tile was opened last. */
  function detailsAnswer(port: ReturnType<Awaited<ReturnType<typeof setup>>['fakePort']>, prompt: string) {
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: opened }));
  }

  const deadlineAlarm = (chromeMock: ReturnType<typeof mockChrome>) =>
    listenerOf<(alarm: { name: string }) => void>(chromeMock.alarms.onAlarm);

  it('a pause keeps collecting: deadlines are cleared, the alarm fails nothing, finished tiles are still saved', async () => {
    const { chromeMock, coordinator, port, prompt } = await submitted(1);
    expect(chromeMock.alarms.create).toHaveBeenCalledWith('vidflow-deadline:s1', { delayInMinutes: 10 });
    await coordinator.handleFlowEvent({ type: 'limit', message: 'quota', resumeAt: null }); // paused until midnight
    expect(coordinator.getRunState()!.status).toBe('paused');
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith('vidflow-deadline:s1');

    deadlineAlarm(chromeMock)({ name: 'vidflow-deadline:s1' }); // a deadline that fired anyway (e.g. raced the clear)
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');

    const fetchMock = stubFetch();
    detailsAnswer(port, prompt);
    vi.mocked(port.press).mockImplementation(async (_tab, x) => {
      if (x !== TILE_X) return;
      await chromeMock.debugger.attach({ tabId: 7 }); // a real press attaches the debugger
      chromeMock.tab.url = `${PROJECT_URL}/edit/generation-1`;
    });
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 saved while paused');
    await coordinator.settledForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coordinator.getRunState()!.status).toBe('paused'); // still paused: nothing more is sent
    expect(vi.mocked(port.press).mock.calls.filter(([, x]) => x === 120)).toHaveLength(1);
    // Opening the picture's detail attached the debugger; a paused run drops it again.
    const lastAttach = Math.max(...chromeMock.debugger.attach.mock.invocationCallOrder);
    expect(Math.max(0, ...chromeMock.debugger.detach.mock.invocationCallOrder)).toBeGreaterThan(lastAttach);
  });

  it('the deadline alarm still fails a scene stuck in Flow while the run is running', async () => {
    const { chromeMock, coordinator } = await submitted(1);
    deadlineAlarm(chromeMock)({ name: 'vidflow-deadline:s1' });
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'failed', 's1 failed at its deadline');
    expect(coordinator.getRunState()!.sceneStates.s1?.message).toBe(
      "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
    );
  });

  it('the deadline alarm leaves a scene that was already refused alone', async () => {
    const { chromeMock, coordinator } = await submitted(1);
    await coordinator.handleFlowEvent({ type: 'refused', sceneId: 's1', message: 'Flow said no.' });
    deadlineAlarm(chromeMock)({ name: 'vidflow-deadline:s1' });
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates.s1).toMatchObject({ status: 'refused', message: 'Flow said no.' });
  });

  it('Resume re-arms a fresh deadline for each scene in Flow and pulls the tiles itself', async () => {
    const { chromeMock, coordinator, port, prompt } = await submitted(1);
    await coordinator.pauseRun();
    const fetchMock = stubFetch();
    detailsAnswer(port, prompt);
    vi.mocked(port.tiles).mockResolvedValue([card('k1', 0)]); // finished while paused; the page reports nothing new
    const armed = () => chromeMock.alarms.create.mock.calls.filter(([name]) => name === 'vidflow-deadline:s1').length;
    expect(armed()).toBe(1);
    await coordinator.resumeRun();
    expect(armed()).toBe(2);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 saved from pulled tiles');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coordinator.getRunState()!.status).toBe('finished');
  });

  it('on worker start, pulls the tiles and saves pictures that finished while it slept', async () => {
    const ctx = await submitted(1);
    const fetchMock = stubFetch();
    // The worker restarts: same storage and database, fresh module state, a new port.
    vi.resetModules();
    const store = await import('../../src/store/projects');
    store.setMediaStore(ctx.media);
    const coordinator = await loadCoordinator();
    const port = ctx.fakePort({ tiles: vi.fn(async () => [card('k1', 0)]) });
    detailsAnswer(port, ctx.prompt);
    coordinator.registerCoordinator();
    coordinator.setFlowPort(port);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 saved after restart');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails an unconfirmed scene whose tile stays generating past the limit, instead of waiting forever', async () => {
    const ctx = await setup(2);
    ctx.coordinator.setTimingsForTests({ ...FAST, unconfirmedWaitMs: 300 });
    const port = ctx.fakePort({ confirmStarted: vi.fn(async () => false), tiles: vi.fn(async () => [card('old', 0)]) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused', 'the unconfirmed pause');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1?.unconfirmed?.at).toEqual(expect.any(Number));
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    const generating: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, progress: 40, caption: prompt };
    vi.mocked(port.tiles).mockResolvedValue([generating, card('old', 1)]);
    await ctx.coordinator.resumeRun();
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'failed', 's1 failed after the wait');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1?.message).toBe(
      "VidFlow couldn't confirm which picture belongs to this scene. Press Try again.",
    );
    expect(port.prepare).toHaveBeenCalledTimes(1); // never pressed again
    expect(ctx.coordinator.getRunState()!.status).toBe('finished');
  });

  it('records the unconfirmed start before pressing, so a worker restarted mid-confirm looks before pressing again', async () => {
    const ctx = await setup(1);
    const hung = ctx.fakePort({
      confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)), // the worker is suspended here
      tiles: vi.fn(async () => [card('old', 0)]),
    });
    ctx.coordinator.setFlowPort(hung);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => vi.mocked(hung.confirmStarted).mock.calls.length === 1, 'the confirm after the press');
    const prompt = vi.mocked(hung.prepare).mock.calls[0]![2];
    const saved = () => (ctx.chromeMock.storage.local.data['vidflow.run'] as { sceneStates: Record<string, { status: string; unconfirmed?: unknown }> }).sceneStates.s1!;
    expect(saved()).toMatchObject({ status: 'pending', unconfirmed: { keysBefore: ['old'], prompt } });

    stubFetch();
    vi.resetModules();
    const store = await import('../../src/store/projects');
    store.setMediaStore(ctx.media);
    const coordinator = await loadCoordinator();
    const port = ctx.fakePort({ tiles: vi.fn(async () => [card('n1', 0), card('old', 1)]) });
    detailsAnswer(port, prompt);
    coordinator.registerCoordinator();
    coordinator.setFlowPort(port);
    await waitFor(() => ['submitted', 'done'].includes(coordinator.getRunState()?.sceneStates.s1?.status ?? ''), 's1 found in Flow');
    expect(vi.mocked(port.press).mock.calls.filter(([, x]) => x === 120)).toHaveLength(0); // not pressed again
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('never fetches a picture from an address outside Flow, and says so', async () => {
    for (const bad of ['https://evil.example/image/k1', 'http://flow-content.google/image/k1', 'https://flow-content.google.evil.example/k1']) {
      const { coordinator, port, prompt } = await submitted(1);
      const fetchMock = stubFetch();
      detailsAnswer(port, prompt);
      await coordinator.handleTiles([{ ...card('k1', 0), imageUrl: bad }]);
      await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'failed', `s1 failed for ${bad}`);
      expect(coordinator.getRunState()!.sceneStates.s1?.message).toBe(
        "Flow gave VidFlow a picture from an address it doesn't trust, so it wasn't saved. Press Try again.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('drops the debugger after the New project press when the run stopped meanwhile', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    const port = fakePort();
    vi.mocked(port.press).mockImplementation(async (_tab, x) => {
      if (x === 5) {
        await coordinator.pauseRun(); // the owner pauses while VidFlow presses New project…
        await chromeMock.debugger.attach({ tabId: 7 }); // …and the press attaches the debugger after that
        chromeMock.tab.url = PROJECT_URL;
      }
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.flowProjectUrl === PROJECT_URL, 'the new project recorded');
    await coordinator.settledForTests();
    const lastAttach = Math.max(...chromeMock.debugger.attach.mock.invocationCallOrder);
    expect(Math.max(0, ...chromeMock.debugger.detach.mock.invocationCallOrder)).toBeGreaterThan(lastAttach);
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('a pause longer than the unconfirmed limit does not fail the scene at the first look after Resume', async () => {
    const ctx = await setup(2);
    ctx.coordinator.setTimingsForTests({ ...FAST, unconfirmedWaitMs: 1000 });
    const port = ctx.fakePort({ confirmStarted: vi.fn(async () => false), tiles: vi.fn(async () => [card('old', 0)]) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused', 'the unconfirmed pause');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    const generating: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, progress: 40, caption: prompt };
    vi.mocked(port.tiles).mockResolvedValue([generating, card('old', 1)]);
    await new Promise((r) => setTimeout(r, 1100)); // paused longer than the limit
    await ctx.coordinator.resumeRun();
    const before = vi.mocked(port.tiles).mock.calls.length;
    await waitFor(
      () => vi.mocked(port.tiles).mock.calls.length >= before + 3 || ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'failed',
      'a few looks after Resume',
    );
    expect(ctx.coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    expect(port.prepare).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('while paused with the tab off the project, a tile report neither moves the tab, presses, nor fails the scene', async () => {
    const { chromeMock, coordinator, port } = await submitted(1);
    await coordinator.pauseRun();
    chromeMock.tab.url = 'https://flow.google.com/'; // the owner took the tab elsewhere to fix something
    const updates = chromeMock.tabs.update.mock.calls.length;
    const presses = vi.mocked(port.press).mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await coordinator.handleTiles([card('k1', 0)]);
      await coordinator.settledForTests();
    }
    expect(chromeMock.tabs.update.mock.calls.length).toBe(updates);
    expect(chromeMock.tabs.goBack).not.toHaveBeenCalled();
    expect(vi.mocked(port.press).mock.calls.length).toBe(presses);
    expect(port.readDetail).not.toHaveBeenCalled();
    expect(chromeMock.tab.url).toBe('https://flow.google.com/');
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');
  });

  it('while paused, a detail that stays unreadable is opened at most GIVE_UP_AFTER - 1 times and fails nothing', async () => {
    const { chromeMock, coordinator, port, prompt } = await submitted(1);
    await coordinator.pauseRun();
    expect(chromeMock.tab.url).toBe(PROJECT_URL); // on the project: reads are allowed
    vi.mocked(port.readDetail).mockResolvedValue({ prompt, mediaId: 'someone-else' }); // never this card
    const tilePresses = () => vi.mocked(port.press).mock.calls.filter(([, x]) => x === TILE_X).length;
    for (let i = 0; i < 5; i++) {
      await coordinator.handleTiles([{ ...card('k1', 0), caption: `Stickman title k1 (report ${i})` }]); // a fresh report each time
      await coordinator.settledForTests();
    }
    expect(tilePresses()).toBeLessThanOrEqual(1); // GIVE_UP_AFTER (2) - 1
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted');
    expect(coordinator.getRunState()!.detailPrompts?.k1).toBeUndefined(); // not given up on while paused
  });
});

describe('live step and activity log', () => {
  const activityOf = (chromeMock: ReturnType<typeof mockChrome>, projectId: string) =>
    ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as { projectId: string; sceneId: string | null; text: string }[])
      .filter((e) => e.projectId === projectId)
      .map((e) => e.text);

  it("logs the run's activity in order", async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup(1);
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) }));
    vi.stubGlobal('fetch', fetchMock);
    const port = fakePort();
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: opened }));
    await coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 done');
    await coordinator.settledForTests();

    const texts = activityOf(chromeMock, project.id);
    expect(texts.slice(0, 7)).toEqual([
      'Opened a new Flow project',
      'Set Flow to Image · 9:16 · 1 picture',
      'Typing the prompt',
      'Pressing Generate',
      'Sent to Flow',
      'Checking picture 1 of 1 matches its prompt',
      '✓ Saved 1 picture',
    ]);
    expect(texts[7]).toMatch(/^Finished/);
    // A finished run isn't doing anything: no current step.
    expect(chromeMock.storage.local.data['vidflow.step']).toBeUndefined();
  });

  it('shows the step while running and clears it when paused', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup(1);
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    const port = fakePort({ confirmStarted: vi.fn(async () => (await gate, true)) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => (chromeMock.storage.local.data['vidflow.step'] as { text?: string } | undefined)?.text === 'Pressing Generate');
    expect(chromeMock.storage.local.data['vidflow.step']).toMatchObject({ projectId: project.id, sceneId: 's1', target: 'generate' });
    await coordinator.pauseRun();
    await waitFor(() => chromeMock.storage.local.data['vidflow.step'] === undefined, 'the step to clear');
    expect(activityOf(chromeMock, project.id)).toContain('Paused by you');
    release();
    await coordinator.settledForTests();
    await coordinator.resumeRun();
    await coordinator.settledForTests();
    expect(activityOf(chromeMock, project.id)).toContain('Resumed');
  });

  it('a failing or slow storage never breaks the run', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup(1);
    const realSet = chromeMock.storage.local.set.getMockImplementation()!;
    chromeMock.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      if ('vidflow.activity' in items || 'vidflow.step' in items) throw new Error('quota');
      return realSet(items);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
  });
});

describe("the scene's chosen picture", () => {
  it('a choice made during a run survives the next run broadcast', async () => {
    const { coordinator, project, fakePort } = await setup(2);
    const store = await import('../../src/store/projects');
    // Scene 1 already has pictures; scene 2 is still to make, so the run stays live.
    const saved = (await store.getProject(project.id))!;
    saved.scenes = [...saved.scenes, { ...saved.scenes[0]!, id: 's2', slide: 2, imagePrompt: 'A stickman sits' }];
    saved.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: ['m/a', 'm/b'] } };
    await store.saveProject(saved);
    const heard: import('../../src/runs/run').RunState[] = [];
    coordinator.onRunState((s) => heard.push(s));
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'running');

    await expect(coordinator.chooseScenePicture(project.id, 's1', 'm/zz')).rejects.toThrow();
    await coordinator.chooseScenePicture(project.id, 's1', 'm/b');
    await coordinator.pauseRun(); // the next broadcast
    await waitFor(() => heard.at(-1)?.status === 'paused');

    expect(heard.at(-1)!.sceneStates.s1?.chosenPictureId).toBe('m/b');
    expect((await store.getProject(project.id))!.sceneStates.s1?.chosenPictureId).toBe('m/b');
  });

  it('a choice with no live run goes straight into the stored project', async () => {
    const { coordinator, project } = await setup(2);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    saved.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: ['m/a', 'm/b'] } };
    await store.saveProject(saved);
    await coordinator.chooseScenePicture(project.id, 's1', 'm/b');
    expect((await store.getProject(project.id))!.sceneStates.s1?.chosenPictureId).toBe('m/b');
    await expect(coordinator.chooseScenePicture(project.id, 's1', 'm/zz')).rejects.toThrow();
    expect(coordinator.getRunState()).toBeNull();
  });

  it('choosing on a project that is not the live run\'s saves it to that project and leaves the run alone', async () => {
    const { coordinator, project, fakePort } = await setup(2);
    const store = await import('../../src/store/projects');
    const other = await store.createProject('Other');
    other.scenes = [{ ...project.scenes[0]! }];
    other.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: ['o/a', 'o/b'] } };
    await store.saveProject(other);
    const heard: import('../../src/runs/run').RunState[] = [];
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startRun(project.id);
    // Settled: the run is waiting on Flow's start (its press recorded), so nothing else changes it meanwhile.
    await waitFor(() => !!coordinator.getRunState()?.sceneStates.s1?.unconfirmed);
    const before = coordinator.getRunState()!;
    coordinator.onRunState((s) => heard.push(s));

    // Same scene id as the live run's scene, but the other project's picture: it must not touch the run.
    await coordinator.chooseScenePicture(other.id, 's1', 'o/b');
    expect((await store.getProject(other.id))!.sceneStates.s1?.chosenPictureId).toBe('o/b');
    expect(coordinator.getRunState()!.projectId).toBe(project.id);
    expect(coordinator.getRunState()!.sceneStates).toEqual(before.sceneStates);
    // Nothing broadcast carries the choice (the studio re-reads the other project itself).
    expect(heard.some((s) => s.projectId !== project.id || Object.values(s.sceneStates).some((x) => x.chosenPictureId))).toBe(false);
    expect((await store.getProject(project.id))!.sceneStates.s1?.chosenPictureId).toBeUndefined();
    // A picture of the live run's project is not one of the other project's.
    await expect(coordinator.chooseScenePicture(other.id, 's1', 'm/a')).rejects.toThrow();
  });

  it('a swap is logged as "Swapped to picture K" for that scene', async () => {
    const { coordinator, project, chromeMock } = await setup(2);
    const store = await import('../../src/store/projects');
    const { ACTIVITY_KEY } = await import('../../src/runs/activity');
    const saved = (await store.getProject(project.id))!;
    saved.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: ['m/a', 'm/b'] } };
    await store.saveProject(saved);
    await coordinator.chooseScenePicture(project.id, 's1', 'm/b');
    await coordinator.chooseScenePicture(project.id, 's1', 'm/a');
    const log = chromeMock.storage.local.data[ACTIVITY_KEY] as import('../../src/runs/activity').ActivityEntry[];
    expect(log.map((e) => [e.projectId, e.sceneId, e.text])).toEqual([
      [project.id, 's1', 'Swapped to picture 2'],
      [project.id, 's1', 'Swapped to picture 1'],
    ]);
    // A refused choice logs nothing.
    await expect(coordinator.chooseScenePicture(project.id, 's1', 'm/zz')).rejects.toThrow();
    expect((chromeMock.storage.local.data[ACTIVITY_KEY] as unknown[]).length).toBe(2);
  });

  it('try again clears the choice', async () => {
    const { reduceRun } = await import('../../src/runs/run');
    // A finished run whose scene failed after an earlier batch of pictures, one of them chosen.
    let s: import('../../src/runs/run').RunState = {
      projectId: 'p',
      status: 'finished',
      inFlight: [],
      sceneStates: {
        s1: { sceneId: 's1', status: 'failed', message: 'no', pictureIds: ['m/a', 'm/b'], chosenPictureId: 'm/b' },
      },
    };
    s = reduceRun(s, { type: 'retry', sceneId: 's1' });
    s = reduceRun(s, { type: 'submitted', sceneId: 's1' });
    s = reduceRun(s, { type: 'pictures', sceneId: 's1', mediaIds: ['m/c', 'm/d'] });
    expect(s.sceneStates.s1?.pictureIds).toEqual(['m/c', 'm/d']);
    expect(s.sceneStates.s1?.chosenPictureId).toBeUndefined();
  });
});

describe('the hero reference in Flow', () => {
  const NAME = 'vidflow-hero-3f1c2a9e.png'; // the first 8 characters of the Flow project id
  const ATTACH_MESSAGE = "VidFlow couldn't attach the hero reference in Flow. Check the Flow window, then press Resume.";

  /** A two-scene project whose hero has a reference picture in the media store (unless `stored` is false). */
  async function withReference(outputs: 1 | 2 | 4 = 1, stored = true) {
    const ctx = await setup(outputs);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(ctx.project.id))!;
    const picture = new Blob(['png-bytes'], { type: 'image/png' });
    if (stored) await ctx.media.put(saved.id, 'hero-reference', picture);
    saved.character = { description: 'A stickman with a red cap', referenceMediaId: `${saved.id}/hero-reference` };
    saved.scenes = [...saved.scenes, { ...saved.scenes[0]!, id: 's2', slide: 2, imagePrompt: 'A stickman sits' }];
    await store.saveProject(saved);
    return { ...ctx, picture };
  }

  it('uploads the reference once per run, right after the new project opens, and attaches it to every prompt', async () => {
    const { coordinator, project, fakePort } = await withReference();
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 's2 submitted');

    expect(port.uploadReference).toHaveBeenCalledTimes(1);
    const [tabId, name, image] = vi.mocked(port.uploadReference).mock.calls[0]!;
    expect([tabId, name]).toEqual([7, NAME]);
    expect(await image.text()).toBe('png-bytes');
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(order(vi.mocked(port.press))).toBeLessThan(order(vi.mocked(port.uploadReference))); // New project first
    expect(order(vi.mocked(port.uploadReference))).toBeLessThan(order(vi.mocked(port.prepare)));
    expect(vi.mocked(port.prepare).mock.calls.map(([, sceneId, prompt, options]) => [sceneId, prompt.includes('reference picture'), options])).toEqual([
      ['s1', true, { aspect: '9:16', outputs: 1, verb: 'Resume', reference: { name: NAME } }],
      ['s2', true, { aspect: '9:16', outputs: 1, verb: 'Resume', reference: { name: NAME } }],
    ]);
    expect(coordinator.getRunState()!.reference).toEqual({ name: NAME, flowProjectUrl: PROJECT_URL, cardKeys: ['ref-media-1'] });
  });

  it('pauses instead of sending without the reference', async () => {
    const { chromeMock, coordinator, project, fakePort, FlowBlockedError } = await withReference();
    const blocked = () => new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: ATTACH_MESSAGE });
    const port = fakePort({ prepare: vi.fn(async () => Promise.reject(blocked())) }); // the chip didn't show
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused' && chromeMock.debugger.detach.mock.calls.length > 0);
    expect(coordinator.getRunState()!.pauseReason).toBe(ATTACH_MESSAGE);
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    expect(vi.mocked(port.press).mock.calls).toEqual([[7, 5, 5]]); // New project only: Generate was never pressed
  });

  it('pauses when the upload fails, and uploads again on Resume before sending', async () => {
    const { coordinator, project, fakePort, FlowBlockedError } = await withReference();
    const port = fakePort();
    vi.mocked(port.uploadReference).mockRejectedValueOnce(
      new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: ATTACH_MESSAGE }),
    );
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    expect(coordinator.getRunState()!.pauseReason).toBe(ATTACH_MESSAGE);
    expect(port.prepare).not.toHaveBeenCalled();
    await coordinator.resumeRun();
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    expect(port.uploadReference).toHaveBeenCalledTimes(2);
    expect(vi.mocked(port.prepare).mock.calls[0]![3]).toMatchObject({ reference: { name: NAME } });
  });

  it('pauses (scene still pending) when the upload fails with an ordinary error', async () => {
    const { coordinator, project, fakePort } = await withReference();
    const port = fakePort({ uploadReference: vi.fn(async () => Promise.reject(new Error('message channel closed'))) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    expect(coordinator.getRunState()!.pauseReason).toBe(ATTACH_MESSAGE);
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('does not upload when the owner paused while the reference picture was being read', async () => {
    const { coordinator, project, fakePort, media } = await withReference();
    const read = media.get.bind(media);
    vi.spyOn(media, 'get').mockImplementation(async (id) => {
      await coordinator.pauseRun();
      return read(id);
    });
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    await coordinator.settledForTests();
    expect(port.uploadReference).not.toHaveBeenCalled();
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('pauses with a plain message when the reference picture is no longer stored', async () => {
    const { coordinator, project, fakePort } = await withReference(1, false);
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'the run to pause');
    expect(coordinator.getRunState()!.pauseReason).toBe(
      "VidFlow can't find the hero's reference picture. Add it again in the Script step, or remove it, then press Resume.",
    );
    expect(port.uploadReference).not.toHaveBeenCalled();
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('scenes without a reference send as before', async () => {
    const { coordinator, project, fakePort } = await setup();
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    saved.character = { description: 'A stickman with a red cap' }; // a hero, but no reference picture
    await store.saveProject(saved);
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    expect(port.uploadReference).not.toHaveBeenCalled();
    expect(port.prepare).toHaveBeenCalledWith(7, 's1', expect.not.stringContaining('reference'), { aspect: '9:16', outputs: 4, verb: 'Resume' });
    expect(coordinator.getRunState()!.reference).toBeUndefined();
  });

  it.each([
    ['its recorded media id', 'ref-media-1', 'ref-media-1', 'Stickman title'],
    ['its file-name caption', null, 'ref-media-2', NAME],
  ])('the reference tile is never matched (by %s)', async (_how, uploadedKey, refKey, refCaption) => {
    const { chromeMock, coordinator, project, fakePort } = await withReference(1);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    saved.scenes = saved.scenes.slice(0, 1); // one scene
    await store.saveProject(saved);
    const port = fakePort({ uploadReference: vi.fn(async () => uploadedKey) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) })));
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 1 }));
    vi.mocked(port.press).mockImplementation(async (_tab, x) => {
      if (x === TILE_X) chromeMock.tab.url = `${PROJECT_URL}/edit/gen-${opened}`;
    });
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt: opened === 'k1' ? prompt : null, mediaId: opened }));

    // The reference was uploaded first, so it is the oldest tile: by position alone it would be s1's picture.
    await coordinator.handleTiles([card('k1', 0), { ...card(refKey, 1), caption: refCaption }]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 done');
    expect(coordinator.getRunState()!.sceneStates.s1?.cardKeys).toEqual(['k1']);
    expect(vi.mocked(port.tilePoint).mock.calls.map(([, key]) => key)).not.toContain(refKey);
  });
});

describe("Flow's notices", () => {
  const POLICY_MESSAGE = 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Resume.';
  const activityOf = (chromeMock: ReturnType<typeof mockChrome>, projectId: string) =>
    ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as { projectId: string; text: string }[])
      .filter((e) => e.projectId === projectId)
      .map((e) => e.text);
  const blockedBy = (notice: boolean) => ({
    kind: 'blocked',
    event: { type: 'needsOwner', reason: 'policy-dialog', message: POLICY_MESSAGE },
    ...(notice ? { notice: true } : {}),
  });

  /** The real port over a fake Flow tab: prepare answers from `prepares` in turn, accepting a notice answers `accepted`. */
  async function withTab(prepares: unknown[], accepted = true) {
    const ctx = await setup();
    const { FLOW_ACCEPT_NOTICE, FLOW_PREPARE } = await import('../../src/flow/messages');
    const send = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === FLOW_PREPARE) return prepares.shift();
      if (message.type === FLOW_ACCEPT_NOTICE) return { accepted };
      return undefined;
    });
    const real = ctx.createFlowPort({ send, press: async () => undefined, wait: async () => undefined, getZoom: async () => 1 });
    const port = ctx.fakePort({ prepare: vi.fn(real.prepare), acceptNotice: vi.fn(real.acceptNotice) });
    const sent = () => send.mock.calls.map(([, m]) => m.type);
    return { ...ctx, port, sent, FLOW_ACCEPT_NOTICE, FLOW_PREPARE };
  }

  it('accepts a usage notice and carries on when the switch is on', async () => {
    const { chromeMock, coordinator, project, port, sent, FLOW_ACCEPT_NOTICE, FLOW_PREPARE } = await withTab([
      blockedBy(true),
      { kind: 'ready', x: 120, y: 620 },
    ]);
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    expect(sent()).toEqual([FLOW_PREPARE, FLOW_ACCEPT_NOTICE, FLOW_PREPARE]);
    expect(port.acceptNotice).toHaveBeenCalledWith(7);
    expect(activityOf(chromeMock, project.id)).toContain("Accepted Flow's notice");
    expect(coordinator.getRunState()!.status).toBe('running');
  });

  it('accepts a notice on the home page before pressing New project', async () => {
    const { chromeMock, coordinator, project, FlowBlockedError, fakePort } = await setup();
    const notice = new FlowBlockedError({ type: 'needsOwner', reason: 'policy-dialog', message: POLICY_MESSAGE }, true);
    const port = fakePort({ findNewProject: vi.fn().mockRejectedValueOnce(notice).mockResolvedValue({ x: 5, y: 5 }) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    expect(port.findNewProject).toHaveBeenCalledTimes(2);
    expect(port.acceptNotice).toHaveBeenCalledTimes(1);
    expect(activityOf(chromeMock, project.id)).toContain("Accepted Flow's notice");
  });

  it('pauses with the usage-policy message when the notice is still there after accepting it', async () => {
    const { coordinator, project, port } = await withTab([blockedBy(true), blockedBy(true)]);
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('pending');
    expect(port.acceptNotice).toHaveBeenCalledTimes(1); // one try, never a loop
  });

  it("pauses with the usage-policy message when VidFlow can't accept the notice", async () => {
    const { coordinator, project, port } = await withTab([blockedBy(true)], false);
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(port.prepare).toHaveBeenCalledTimes(1);
  });

  it('pauses on a usage notice when the switch is off', async () => {
    const { chromeMock, coordinator, project, port, sent, FLOW_ACCEPT_NOTICE } = await withTab([blockedBy(true)]);
    chromeMock.storage.local.data['vidflow.acceptNotices'] = false;
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(port.acceptNotice).not.toHaveBeenCalled();
    expect(sent()).not.toContain(FLOW_ACCEPT_NOTICE);
  });

  it('never accepts a billing or upgrade dialog', async () => {
    const { chromeMock, coordinator, project, port, sent, FLOW_ACCEPT_NOTICE } = await withTab([blockedBy(false)]);
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(port.acceptNotice).not.toHaveBeenCalled();
    expect(sent()).not.toContain(FLOW_ACCEPT_NOTICE);
    expect(activityOf(chromeMock, project.id)).not.toContain("Accepted Flow's notice");
  });
});

describe("Flow's notices (review fixes)", () => {
  const POLICY_MESSAGE = 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Resume.';
  const activityOf = (chromeMock: ReturnType<typeof mockChrome>, projectId: string) =>
    ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as { projectId: string; text: string }[])
      .filter((e) => e.projectId === projectId)
      .map((e) => e.text);

  it('a notice mid-upload is accepted, logged, the upload retried, and the run carries on', async () => {
    const ctx = await setup(1);
    const { chromeMock, coordinator, project, FlowBlockedError, fakePort, media } = ctx;
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(project.id))!;
    await media.put(saved.id, 'hero-reference', new Blob(['png-bytes'], { type: 'image/png' }));
    saved.character = { description: 'A stickman', referenceMediaId: `${saved.id}/hero-reference` };
    await store.saveProject(saved);
    const notice = new FlowBlockedError({ type: 'needsOwner', reason: 'policy-dialog', message: POLICY_MESSAGE }, true);
    const port = fakePort({
      uploadReference: vi.fn().mockRejectedValueOnce(notice).mockResolvedValue('ref-media-1'),
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    expect(port.uploadReference).toHaveBeenCalledTimes(2);
    expect(port.acceptNotice).toHaveBeenCalledTimes(1);
    expect(activityOf(chromeMock, project.id)).toContain("Accepted Flow's notice");
    expect(coordinator.getRunState()!.status).toBe('running');
  });

  it('a notice after Generate is accepted and the scene left unconfirmed, not paused as "didn\'t start"', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    const port = fakePort({ confirmStarted: vi.fn<() => Promise<boolean | 'notice'>>().mockResolvedValueOnce('notice').mockResolvedValue(true) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    // Left unconfirmed: the next round looks for its tiles (none here), then presses again and Flow starts.
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    expect(port.acceptNotice).toHaveBeenCalledTimes(1);
    expect(port.confirmStarted).toHaveBeenCalledTimes(2);
    expect(port.tiles).toHaveBeenCalled(); // findUnconfirmedStart looked before the second press
    expect(coordinator.getRunState()!.status).toBe('running');
    expect(coordinator.getRunState()!.pauseReason ?? null).toBeNull();
    expect(activityOf(chromeMock, project.id)).toContain("Accepted Flow's notice");
    expect(activityOf(chromeMock, project.id).some((t) => t.includes("didn't start"))).toBe(false);
  });

  it('a persistent notice after Generate is accepted once, then pauses; Generate pressed at most twice', async () => {
    const { coordinator, project, fakePort } = await setup();
    const port = fakePort({ confirmStarted: vi.fn(async (): Promise<boolean | 'notice'> => 'notice') });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(port.acceptNotice).toHaveBeenCalledTimes(1);
    const generatePresses = vi.mocked(port.press).mock.calls.filter(([, x]) => x === 120);
    expect(generatePresses).toHaveLength(2);
  });

  it('a notice after Generate that cannot be accepted pauses with the usage-policy message', async () => {
    const { coordinator, project, fakePort } = await setup();
    const port = fakePort({ confirmStarted: vi.fn(async (): Promise<boolean | 'notice'> => 'notice'), acceptNotice: vi.fn(async () => false) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
  });

  it('a notice after Generate with the switch off pauses with the usage-policy message', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    chromeMock.storage.local.data['vidflow.acceptNotices'] = false;
    const port = fakePort({ confirmStarted: vi.fn(async (): Promise<boolean | 'notice'> => 'notice') });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(port.acceptNotice).not.toHaveBeenCalled();
  });

  it('retries the step once when accepting got no answer (the page reloaded)', async () => {
    const { coordinator, project, FlowBlockedError, fakePort } = await setup();
    const notice = () => new FlowBlockedError({ type: 'needsOwner', reason: 'policy-dialog', message: POLICY_MESSAGE }, true);
    const port = fakePort({
      prepare: vi.fn().mockRejectedValueOnce(notice()).mockResolvedValue({ x: 120, y: 620 }),
      acceptNotice: vi.fn(async () => null),
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    expect(port.prepare).toHaveBeenCalledTimes(2);
  });

  it('accepting with no answer still retries only once, then pauses with the usage-policy message', async () => {
    const again = await setup();
    const notice = () =>
      new again.FlowBlockedError({ type: 'needsOwner', reason: 'policy-dialog', message: POLICY_MESSAGE }, true);
    const stuck = again.fakePort({ prepare: vi.fn(async () => Promise.reject(notice())), acceptNotice: vi.fn(async () => null) });
    again.coordinator.setFlowPort(stuck);
    await again.coordinator.startRun(again.project.id);
    await waitFor(() => again.coordinator.getRunState()?.status === 'paused', 'paused');
    expect(stuck.prepare).toHaveBeenCalledTimes(2); // still capped at one retry
    expect(again.coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
  });
});

describe('keep-awake switch', () => {
  it('keep-awake follows the switch', async () => {
    const on = await setup();
    on.coordinator.setFlowPort(on.fakePort());
    await on.coordinator.startRun(on.project.id);
    await waitFor(() => on.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    expect(on.chromeMock.power.requestKeepAwake).toHaveBeenCalledWith('system');
    await on.coordinator.stopRun();

    const off = await setup();
    off.chromeMock.storage.local.data['vidflow.keepAwake'] = false;
    off.coordinator.setFlowPort(off.fakePort());
    await off.coordinator.startRun(off.project.id);
    await waitFor(() => off.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await off.coordinator.settledForTests();
    expect(off.chromeMock.power.requestKeepAwake).not.toHaveBeenCalled();
    await off.coordinator.stopRun();
    expect(off.chromeMock.power.releaseKeepAwake).toHaveBeenCalled(); // releasing is unchanged
  });

  it('turning keep-awake off mid-run releases it, and on again asks again', async () => {
    const { chromeMock, coordinator, project, fakePort } = await setup();
    coordinator.setFlowPort(fakePort());
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await coordinator.settledForTests();
    chromeMock.power.releaseKeepAwake.mockClear();
    chromeMock.power.requestKeepAwake.mockClear();
    const changed = listenerOf<(changes: Record<string, { newValue?: unknown }>, area: string) => void>(chromeMock.storage.onChanged);
    changed({ 'vidflow.keepAwake': { newValue: false } }, 'local');
    await waitFor(() => chromeMock.power.releaseKeepAwake.mock.calls.length === 1, 'released');
    changed({ 'vidflow.keepAwake': { newValue: true } }, 'local');
    await waitFor(() => chromeMock.power.requestKeepAwake.mock.calls.length === 1, 'requested again');
  });
});

describe('Queue tab: Skip and ▶ Run (spec §19)', () => {
  /** Two scenes, one picture each; `over` changes the fake Flow port. */
  async function twoScenes(over: (ctx: Awaited<ReturnType<typeof setup>>) => Partial<FlowPort> = () => ({})) {
    const ctx = await setup(1);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(ctx.project.id))!;
    saved.scenes = [...saved.scenes, { ...saved.scenes[0]!, id: 's2', slide: 2, imagePrompt: 'A stickman sits' }];
    await store.saveProject(saved);
    const port = ctx.fakePort(over(ctx));
    ctx.coordinator.setFlowPort(port);
    return { ...ctx, port, store };
  }
  const promptFor = (port: FlowPort, sceneId: string) => vi.mocked(port.prepare).mock.calls.find((c) => c[1] === sceneId)![2];
  const setStepTo = (chromeMock: ReturnType<typeof mockChrome>, projectId: string, sceneId: string) =>
    void (chromeMock.storage.local.data['vidflow.step'] = { projectId, sceneId, text: 'Checking', target: 'tile', at: Date.now() });

  it('pictures arriving for a skipped scene are never saved', async () => {
    const { chromeMock, coordinator, project, port, media } = await twoScenes();
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) }));
    vi.stubGlobal('fetch', fetchMock);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 'both scenes in Flow');
    await coordinator.settledForTests();

    // The panel's step names scene 1: Skip ends it, though Flow is still drawing it.
    setStepTo(chromeMock, project.id, 's1');
    await coordinator.skipCurrent();
    expect(coordinator.getRunState()!.sceneStates.s1).toMatchObject({ status: 'failed', message: coordinator.SKIPPED_MESSAGE });

    // Flow then shows scene 1's picture (older) and scene 2's (newer). Each card's detail is its own prompt.
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ({ x: TILE_X, y: key === 'k1' ? 1 : 2 }));
    let opened = '';
    vi.mocked(port.press).mockImplementation(async (_tab, x, y) => {
      if (x === TILE_X) {
        opened = y === 1 ? 'k1' : 'k2';
        chromeMock.tab.url = `${PROJECT_URL}/edit/gen-${opened}`;
      }
    });
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt: promptFor(port, opened === 'k1' ? 's1' : 's2'), mediaId: opened }));
    await coordinator.handleTiles([card('k2', 0), card('k1', 1)]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'done', 'scene 2 saved');
    await coordinator.settledForTests();

    const run = coordinator.getRunState()!;
    expect(run.sceneStates.s2).toMatchObject({ cardKeys: ['k2'] });
    expect(run.sceneStates.s1).toMatchObject({ status: 'failed', message: 'Skipped by you', pictureIds: [] });
    // Scene 1's card took its place in the order (it never shifted onto scene 2) and was never fetched or opened.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://flow-content.google/image/k2']);
    expect(vi.mocked(port.tilePoint).mock.calls.map((c) => c[1])).toEqual(['k2']);
    expect(await media.get(`${project.id}/scene-01-option-1`)).toBeUndefined();
    expect(run.status).toBe('finished');
  });

  it('Skip while the prompt is being typed: Generate is never pressed for it, and the run moves on', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { coordinator, project, port } = await twoScenes(() => ({
      prepare: vi.fn(async (_tab: number, sceneId: string) => {
        if (sceneId === 's1') await gate;
        return { x: 120, y: 620 };
      }),
    }));
    await coordinator.startRun(project.id);
    await waitFor(() => vi.mocked(port.prepare).mock.calls.length === 1, 'scene 1 being typed');
    await coordinator.skipCurrent();
    release();
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 'scene 2 sent');
    expect(coordinator.getRunState()!.sceneStates.s1).toMatchObject({ status: 'failed', message: 'Skipped by you' });
    expect(vi.mocked(port.press).mock.calls.filter((c) => c[1] === 120)).toHaveLength(1); // scene 2's press only
  });

  it('Skip with nothing live changes nothing', async () => {
    const { coordinator } = await twoScenes();
    await coordinator.skipCurrent();
    expect(coordinator.getRunState()).toBeNull();
  });

  it('▶ Run on a scene of a video with no run makes just that scene', async () => {
    const { coordinator, project, port } = await twoScenes();
    await coordinator.retryScene(project.id, 's2');
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 'scene 2 sent');
    expect(Object.keys(coordinator.getRunState()!.sceneStates)).toEqual(['s2']);
    expect(vi.mocked(port.prepare).mock.calls.map((c) => c[1])).toEqual(['s2']);
  });

  it("Try again on a scene outside this video's finished run adds it to that run", async () => {
    const { coordinator, project, store } = await twoScenes();
    await coordinator.retryScene(project.id, 's2');
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 'scene 2 sent');
    await coordinator.handleFlowEvent({ type: 'refused', sceneId: 's2', message: 'no' });
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'finished');
    const saved = (await store.getProject(project.id))!;
    saved.sceneStates = { ...saved.sceneStates, s1: { sceneId: 's1', status: 'failed', message: 'x', pictureIds: [] } };
    await store.saveProject(saved);

    await coordinator.retryScene(project.id, 's1');
    const run = coordinator.getRunState()!;
    expect(run.status).toBe('running');
    expect(run.sceneStates.s1).toMatchObject({ status: 'pending' });
    expect(run.sceneStates.s2).toMatchObject({ status: 'refused' });
  });
});

describe('Queue review fixes', () => {
  const okFetch = () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  /** A fake port whose tile presses open that card's detail page, which shows `detail(key)` as its prompt. */
  function detailPort(ctx: Awaited<ReturnType<typeof setup>>, detail: (key: string) => string, over: Partial<FlowPort> = {}) {
    let opened = '';
    const keys: string[] = [];
    const port = ctx.fakePort({
      tilePoint: vi.fn(async (_tab: number, key: string) => {
        if (!keys.includes(key)) keys.push(key);
        return { x: TILE_X, y: keys.indexOf(key) + 1 };
      }),
      press: vi.fn(async (_tab: number, x: number, y: number) => {
        if (x === 5) ctx.chromeMock.tab.url = PROJECT_URL;
        if (x === TILE_X) {
          opened = keys[y - 1]!;
          ctx.chromeMock.tab.url = `${PROJECT_URL}/edit/gen-${opened}`;
        }
      }),
      readDetail: vi.fn(async () => ({ prompt: detail(opened), mediaId: opened })),
      ...over,
    });
    ctx.coordinator.setFlowPort(port);
    return port;
  }
  const promptOf = (port: FlowPort, sceneId: string) => vi.mocked(port.prepare).mock.calls.find((c) => c[1] === sceneId)?.[2] ?? '';

  it('saved pictures record whether the hero reference was attached in Flow', async () => {
    const ctx = await setup(1);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(ctx.project.id))!;
    await ctx.media.put(saved.id, 'hero-reference', new Blob(['png'], { type: 'image/png' }));
    saved.character = { description: 'A stickman', referenceMediaId: `${saved.id}/hero-reference` };
    await store.saveProject(saved);
    okFetch();
    const port = detailPort(ctx, () => promptOf(port, 's1'));
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await ctx.coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'done', 'saved');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1!.withHero).toBe(true);
    expect((await store.getProject(ctx.project.id))!.sceneStates.s1!.withHero).toBe(true);
  });

  it('pictures made without a reference say so', async () => {
    const ctx = await setup(1);
    okFetch();
    const port = detailPort(ctx, () => promptOf(port, 's1'));
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await ctx.coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'done', 'saved');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1!.withHero).toBe(false);
  });

  it('a scene skipped while its pictures are being fetched writes nothing to the media store', async () => {
    const ctx = await setup(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let fetching = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetching = true;
        await gate;
        return { ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) };
      }),
    );
    const put = vi.spyOn(ctx.media, 'put');
    const port = detailPort(ctx, () => promptOf(port, 's1'));
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await ctx.coordinator.handleTiles([card('k1', 0)]);
    await waitFor(() => fetching, 'fetching the picture');
    await ctx.coordinator.skipCurrent();
    release();
    await ctx.coordinator.settledForTests();
    await new Promise((r) => setTimeout(r, 30));
    expect(put).not.toHaveBeenCalled();
    expect(ctx.coordinator.getRunState()!.sceneStates.s1).toMatchObject({ status: 'failed', message: 'Skipped by you', pictureIds: [] });
  });

  it("a skipped submission older than the scene deadline no longer holds a later scene's picture", async () => {
    const ctx = await setup(1);
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(ctx.project.id))!;
    saved.scenes = [...saved.scenes, { ...saved.scenes[0]!, id: 's2', slide: 2, imagePrompt: 'A stickman sits' }];
    await store.saveProject(saved);
    okFetch();
    const port = detailPort(ctx, () => promptOf(port, 's2'));
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 'both in Flow');
    await ctx.coordinator.settledForTests();
    ctx.chromeMock.storage.local.data['vidflow.step'] = { projectId: ctx.project.id, sceneId: 's1', text: 'x', target: 'tile', at: Date.now() };
    await ctx.coordinator.skipCurrent();
    expect(ctx.coordinator.getRunState()!.skippedPrompts).toHaveLength(1);

    // Scene 1 never comes; 11 minutes later only scene 2's picture is in the grid.
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 11 * 60_000);
    await ctx.coordinator.handleTiles([card('k2', 0)]);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s2?.status === 'done', 'scene 2 saved');
    expect(ctx.coordinator.getRunState()!.sceneStates.s2!.cardKeys).toEqual(['k2']);
    vi.mocked(Date.now).mockRestore();
  });

  it("on Resume, a skipped submission whose tiles were already there before the press isn't counted as owed", async () => {
    const ctx = await setup(1);
    let tiles: FlowResultCard[] = [];
    let started = true;
    const port = detailPort(ctx, () => promptOf(port, 's1'), {
      tiles: vi.fn(async () => tiles),
      confirmStarted: vi.fn(async () => started),
    });
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await ctx.coordinator.skipCurrent();
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'finished');

    // Scene 1's skipped picture is in the grid; Try again sends it again, but Flow's start isn't seen.
    tiles = [card('k1', 0)];
    started = false;
    await ctx.coordinator.retryScene(ctx.project.id, 's1');
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'paused', 'paused: not started');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1?.unconfirmed?.keysBefore).toEqual(['k1']);

    // It did start: a new tile with its prompt. Resume must take it, not press Generate again.
    tiles = [card('k1b', 0), card('k1', 1)];
    started = true;
    await ctx.coordinator.resumeRun();
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 'taken as submitted');
    expect(port.prepare).toHaveBeenCalledTimes(2); // the first send and Try again; never a third press
  });

  it('▶ Run on a paused run with nothing else left resumes it, so the scene is made', async () => {
    const ctx = await setup(1);
    const port = ctx.fakePort({ confirmStarted: vi.fn(async () => true) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted');
    await ctx.coordinator.pauseRun();
    await ctx.coordinator.handleFlowEvent({ type: 'refused', sceneId: 's1', message: 'no' });
    const before = ctx.coordinator.getRunState()!;
    expect(before.status).toBe('paused'); // paused with nothing left: not live, so ▶ Run is offered

    await ctx.coordinator.retryScene(ctx.project.id, 's1');
    expect(ctx.coordinator.getRunState()!.status).toBe('running');
    await waitFor(() => vi.mocked(port.prepare).mock.calls.length === 2, 'sent again');
  });
});

describe('panel upgrade: final review fixes', () => {
  const POLICY_MESSAGE = 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Resume.';
  const activityOf = (chromeMock: ReturnType<typeof mockChrome>, projectId: string) =>
    ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as { projectId: string; text: string }[])
      .filter((e) => e.projectId === projectId)
      .map((e) => e.text);

  /** A run that has sent s1 and is now only waiting for its tiles. */
  async function waiting(acceptNotice: FlowPort['acceptNotice']) {
    const ctx = await setup();
    const port = ctx.fakePort({ acceptNotice: vi.fn(acceptNotice) });
    ctx.coordinator.setFlowPort(port);
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    await ctx.coordinator.settledForTests();
    return { ...ctx, port };
  }

  it('a usage notice seen while waiting for tiles is accepted and logged; the run carries on', async () => {
    const { chromeMock, coordinator, project, port } = await waiting(async () => true);
    await coordinator.handleFlowNotice(7);
    expect(port.acceptNotice).toHaveBeenCalledWith(7);
    expect(activityOf(chromeMock, project.id)).toContain("Accepted Flow's notice");
    expect(coordinator.getRunState()!.status).toBe('running');
  });

  it("a usage notice seen while waiting that can't be accepted pauses with the usage-policy message", async () => {
    const { coordinator, port } = await waiting(async () => false);
    await coordinator.handleFlowNotice(7);
    expect(port.acceptNotice).toHaveBeenCalledTimes(1);
    expect(coordinator.getRunState()!.status).toBe('paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
  });

  it('a notice already gone (accepted by the run itself meanwhile) changes nothing', async () => {
    const { chromeMock, coordinator, project } = await waiting(async () => 'gone');
    await coordinator.handleFlowNotice(7);
    expect(coordinator.getRunState()!.status).toBe('running');
    expect(activityOf(chromeMock, project.id)).not.toContain("Accepted Flow's notice");
  });

  it('a notice that keeps coming back while waiting is accepted a few times at most, then pauses', async () => {
    const { coordinator, port } = await waiting(async () => true);
    for (let i = 0; i < 6 && coordinator.getRunState()!.status === 'running'; i++) await coordinator.handleFlowNotice(7);
    expect(coordinator.getRunState()!.status).toBe('paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(vi.mocked(port.acceptNotice).mock.calls.length).toBe(coordinator.MAX_WAITING_NOTICES);
  });

  it('with the switch off, or a paused run, a notice event accepts nothing', async () => {
    const { chromeMock, coordinator, port } = await waiting(async () => true);
    chromeMock.storage.local.data['vidflow.acceptNotices'] = false;
    await coordinator.handleFlowNotice(7);
    expect(port.acceptNotice).not.toHaveBeenCalled();
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    chromeMock.storage.local.data['vidflow.acceptNotices'] = true;
    await coordinator.handleFlowNotice(7); // paused now: nothing more happens
    expect(port.acceptNotice).not.toHaveBeenCalled();
  });

  it('a billing dialog after Generate pauses with the billing message, not "didn\'t start"', async () => {
    const { coordinator, project, fakePort } = await setup();
    const port = fakePort({ confirmStarted: vi.fn(async () => 'billing' as const) });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    expect(coordinator.getRunState()!.pauseReason).toBe(POLICY_MESSAGE);
    expect(coordinator.getRunState()!.pauseReason).not.toBe(coordinator.NOT_STARTED_MESSAGE);
    expect(port.acceptNotice).not.toHaveBeenCalled(); // billing is never accepted
  });

  it("Test one prompt's Flow project uses Test wording, and refuses a paused run with the paused message", async () => {
    const { coordinator, project, fakePort, chromeMock } = await setup();
    const port = fakePort();
    coordinator.setFlowPort(port);
    vi.mocked(port.press).mockImplementation(async () => void (chromeMock.tab.url = PROJECT_URL));
    await coordinator.openTestFlowProject(7);
    expect(port.findNewProject).toHaveBeenCalledWith(7, 'Test');

    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'running');
    await coordinator.pauseRun();
    const { TEST_WHILE_PAUSED_MESSAGE } = await import('../../src/flow/messages');
    await expect(coordinator.openTestFlowProject(7)).rejects.toThrow(TEST_WHILE_PAUSED_MESSAGE);
    expect(coordinator.testPromptRefusal()).toBe(TEST_WHILE_PAUSED_MESSAGE);
  });

  it('a second Test one prompt while one is running never says "press Start"', async () => {
    const { coordinator } = await setup();
    let release!: () => void;
    const first = coordinator.whileTestingPrompt(() => new Promise<void>((r) => (release = r)));
    const err = await coordinator.whileTestingPrompt(async () => undefined).catch((e: unknown) => e);
    expect((err as Error).message).toBe('VidFlow is already testing one prompt. Wait a few seconds, then try again.');
    release();
    await first;
  });
});

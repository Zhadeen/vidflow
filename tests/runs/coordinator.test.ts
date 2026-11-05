import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';
import type { FlowResultCard } from '../../src/flow/driver';
import type { FlowPort } from '../../src/runs/coordinator';

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
      goBack: vi.fn(async () => void (tab.url = tab.url.replace(/\/edit\/.*$/, ''))),
      setZoom: vi.fn(async () => undefined),
      getZoom: vi.fn(async () => 1),
    },
    runtime: { onStartup: listener(), getURL: (p: string) => `chrome-extension://test/${p}` },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

async function setup(outputs: 1 | 2 | 4 = 4) {
  vi.resetModules();
  const chromeMock = mockChrome();
  const store = await import('../../src/store/projects');
  const media = memoryMediaStore();
  store.setMediaStore(media);
  const coordinator = await import('../../src/runs/coordinator');
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
    confirmStarted: vi.fn(async () => true),
    tiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    tilePoint: vi.fn(async () => ({ x: TILE_X, y: 300 })),
    readDetail: vi.fn(async () => ({ prompt: null as string | null, mediaId: null as string | null })),
    ...over,
  });
  return { chromeMock, coordinator, project, media, FlowBlockedError, createFlowPort, pressAt, fakePort };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
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
    await new Promise((r) => setTimeout(r, 30)); // give a wrongly-unguarded press time to show up

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

  it('never saves a card whose detail prompt differs, and fails the scene when the detail stays unreadable', async () => {
    const { coordinator, port } = await submitted(1);
    const fetchMock = stubFetch();
    vi.mocked(port.readDetail).mockResolvedValueOnce({ prompt: 'A stickman reads a book', mediaId: 'other' });
    await coordinator.handleTiles([card('other', 0)]);
    await waitFor(() => coordinator.getRunState()?.detailPrompts?.other !== undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(coordinator.getRunState()!.sceneStates.s1?.status).toBe('submitted'); // still waiting for its own picture
    expect(fetchMock).not.toHaveBeenCalled();

    vi.mocked(port.readDetail).mockResolvedValue({ prompt: null, mediaId: 'k1' });
    await coordinator.handleTiles([card('k1', 0), card('other', 1)]);
    await waitFor(() => vi.mocked(port.readDetail).mock.calls.length === 2);
    await new Promise((r) => setTimeout(r, 30));
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
    await new Promise((r) => setTimeout(r, 50));
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
    await new Promise((r) => setTimeout(r, 50));
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
    await new Promise((r) => setTimeout(r, 50));
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
    expect(scene.unconfirmed).toEqual({ keysBefore: ['old'], prompt: vi.mocked(port.prepare).mock.calls[0]![2] });
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
    await waitFor(() => vi.mocked(port.tiles).mock.calls.length >= 2);
    await new Promise((r) => setTimeout(r, 50));
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

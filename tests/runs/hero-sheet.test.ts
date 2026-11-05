import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const tab = { id: 7, windowId: 3, url: 'https://flow.google.com/', active: true };
  const chromeMock = {
    tab,
    storage: { local: area(), session: area() },
    alarms: { create: vi.fn(async (_name: string, _info: unknown) => undefined), clear: vi.fn(async () => true), onAlarm: listener() },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
    notifications: { create: vi.fn(async () => '') },
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
    confirmStarted: vi.fn(async () => true),
    tiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    tilePoint: vi.fn(async () => ({ x: TILE_X, y: 300 })),
    readDetail: vi.fn(async () => ({ prompt: null as string | null, mediaId: null as string | null })),
    uploadReference: vi.fn(async (_tabId: number, _name: string, _image: Blob): Promise<string | null> => 'ref-media-1'),
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

const HERO = 'A tall stickman with a red scarf';

/** The project's hero has a description and (unless `reference` is false) a stored reference picture. */
async function withHero(outputs: 1 | 2 | 4 = 2, reference = true) {
  const ctx = await setup(outputs);
  const store = await import('../../src/store/projects');
  const saved = (await store.getProject(ctx.project.id))!;
  if (reference) await ctx.media.put(saved.id, 'hero-reference', new Blob(['png-bytes'], { type: 'image/png' }));
  saved.character = { description: HERO, ...(reference ? { referenceMediaId: `${saved.id}/hero-reference` } : {}) };
  saved.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: [`${saved.id}/scene-01-option-1`] } };
  await store.saveProject(saved);
  return { ...ctx, store };
}

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([`png:${url}`], { type: 'image/png' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the hero model sheet in Flow', () => {
  it('makes the sheet in a fresh Flow project and saves its pictures', async () => {
    const { chromeMock, coordinator, project, fakePort, media, store } = await withHero(2);
    stubFetch();
    const port = fakePort();
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
    coordinator.setFlowPort(port);
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates['hero-sheet']?.status === 'submitted', 'the sheet submitted');

    // A fresh Flow project: New project pressed first, then the one prompt.
    expect(port.findNewProject).toHaveBeenCalledWith(7, 'Resume');
    expect(vi.mocked(port.press).mock.calls[0]).toEqual([7, 5, 5]);
    expect(coordinator.getRunState()!.flowProjectUrl).toBe(PROJECT_URL);
    expect(port.prepare).toHaveBeenCalledTimes(1);
    const [, sceneId, prompt, options] = vi.mocked(port.prepare).mock.calls[0]!;
    expect(sceneId).toBe('hero-sheet');
    expect(prompt).toMatch(/front/i);
    expect(prompt).toMatch(/red scarf/);
    // The sheet makes the reference: never uploaded or attached, even though the hero already has one.
    expect(options).toEqual({ aspect: '9:16', outputs: 2, verb: 'Resume' });
    expect(port.uploadReference).not.toHaveBeenCalled();
    expect(prompt).not.toMatch(/Ingredient|reference picture/i);
    // Its own run: only the sheet, nothing from the scenes.
    expect(Object.keys(coordinator.getRunState()!.sceneStates)).toEqual(['hero-sheet']);

    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: opened }));
    await coordinator.handleTiles([card('k2', 0), card('k1', 1)]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the sheet finished');
    await coordinator.settledForTests();

    const saved = (await store.getProject(project.id))!;
    expect(saved.heroSheet).toEqual({
      status: 'done',
      pictureIds: [`${project.id}/hero-sheet-option-1`, `${project.id}/hero-sheet-option-2`],
      aspect: '9:16',
    });
    expect(await (await media.get(`${project.id}/hero-sheet-option-1`))!.text()).toBe('png:https://flow-content.google/image/k1');
    // Never in the scenes' states (grid, progress, export).
    expect(saved.sceneStates).toEqual({ s1: { sceneId: 's1', status: 'done', pictureIds: [`${project.id}/scene-01-option-1`] } });
    // The finished notice talks about the sheet, not scenes.
    const notices = chromeMock.notifications.create.mock.calls.map((c) => (c as unknown as [{ message: string }])[0].message);
    expect(notices.some((m) => /model sheet/i.test(m))).toBe(true);
    expect(notices.some((m) => /scenes/.test(m))).toBe(false);
  });

  it('model sheet refuses while a run is live', async () => {
    const { coordinator, project, fakePort, store } = await withHero(1);
    const other = await store.createProject('Other');
    other.character = { description: HERO };
    await store.saveProject(other);
    const mine = (await store.getProject(project.id))!;
    mine.sceneStates = {}; // a scene still to make, so the scene run stays live
    await store.saveProject(mine);
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'running');
    // This video's own scenes are being made: it says so; another video's run is the usual busy message.
    await expect(coordinator.startHeroSheetRun(project.id)).rejects.toThrow(coordinator.HERO_SHEET_SCENES_BUSY);
    expect(coordinator.HERO_SHEET_SCENES_BUSY).toBe('This video is making pictures right now. Wait for it to finish, then make the model sheet.');
    await expect(coordinator.startHeroSheetRun(other.id)).rejects.toThrow(coordinator.BUSY_MESSAGE);
    expect(coordinator.getRunState()!.sceneStates).toHaveProperty('s1');
  });

  it("a scene run won't start while the model sheet is being made", async () => {
    const { coordinator, project, fakePort } = await withHero(1);
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'running');
    await expect(coordinator.startRun(project.id)).rejects.toThrow(coordinator.HERO_SHEET_BUSY_MESSAGE);
    // Try again on a scene doesn't vanish into the sheet's run either.
    await expect(coordinator.retryScene(project.id, 's1')).rejects.toThrow(coordinator.HERO_SHEET_BUSY_MESSAGE);
  });

  it('needs a description of the hero', async () => {
    const { coordinator, project, fakePort, store } = await withHero(1, false);
    const saved = (await store.getProject(project.id))!;
    saved.character = null;
    await store.saveProject(saved);
    coordinator.setFlowPort(fakePort());
    await expect(coordinator.startHeroSheetRun(project.id)).rejects.toThrow(coordinator.HERO_SHEET_NEEDS_HERO);
    expect(coordinator.getRunState()).toBeNull();
  });

  it("a refused sheet keeps Flow's reason, and trying again makes it in a new Flow project", async () => {
    const { chromeMock, coordinator, project, fakePort, store } = await withHero(1);
    const port = fakePort();
    coordinator.setFlowPort(port);
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates['hero-sheet']?.status === 'submitted');
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    const refusedTile: FlowResultCard = { ...card('pending-0', 0), imageUrl: null, caption: prompt, refusal: 'Might violate policy' };
    await coordinator.handleTiles([refusedTile]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the refusal');
    await coordinator.settledForTests();
    expect((await store.getProject(project.id))!.heroSheet).toEqual({ status: 'refused', pictureIds: [], message: 'Might violate policy', aspect: '9:16' });

    chromeMock.tab.url = 'https://flow.google.com/';
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => vi.mocked(port.prepare).mock.calls.length === 2, 'the sheet sent again');
    expect(port.findNewProject).toHaveBeenCalledTimes(2);
    await waitFor(() => coordinator.getRunState()?.sceneStates['hero-sheet']?.status === 'submitted');
    await coordinator.settledForTests(); // the run state is set before the project is saved
    expect((await store.getProject(project.id))!.heroSheet?.status).toBe('submitted');
  });

  it('the Flow pill and the log call it the model sheet, never a scene', async () => {
    const { chromeMock, coordinator, project, fakePort } = await withHero(1);
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(async () => (await gate, true)) }));
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => (chromeMock.storage.local.data['vidflow.step'] as { text?: string } | undefined)?.text === 'Pressing Generate');
    const view = (await coordinator.pillFor(7))!;
    expect(view.step).toBe('Model sheet · Pressing Generate');
    expect(view.scene).toBeNull();
    expect(view.savedCards).toEqual([]);
    const log = (chromeMock.storage.local.data['vidflow.activity'] ?? []) as { sceneId: string | null; text: string }[];
    expect(log.find((e) => e.text === 'Typing the prompt')?.sceneId).toBe('hero-sheet');
    release();
    await coordinator.settledForTests();
  });
});

describe('the model sheet stays out of the scenes', () => {
  it("a hero-sheet run never counts in the project's scene progress, phase or labels", async () => {
    const { pictureProgress, runPhase, sceneStatesFor } = await import('../../src/studio/progress');
    const { entryLabel } = await import('../../src/runs/activity');
    const { liveView } = await import('../../src/flow/live');
    const project = {
      id: 'p1',
      name: 'Demo',
      createdAt: 0,
      updatedAt: 0,
      scenes: [{ id: 's1', slide: 1, start: null, end: null, sentence: '', concept: '', textOverlay: '', imagePrompt: 'x', motionPrompt: 'x', motionPromptIsDefault: false }],
      style: 'stickman-whiteboard' as const,
      character: { description: HERO },
      aspect: '16:9' as const,
      outputsPerPrompt: 2 as const,
      sceneStates: {},
    };
    const run = {
      projectId: 'p1',
      kind: 'hero-sheet' as const,
      status: 'running' as const,
      inFlight: ['hero-sheet'],
      sceneStates: { 'hero-sheet': { sceneId: 'hero-sheet', status: 'done' as const, pictureIds: ['p1/hero-sheet-option-1'], cardKeys: ['k1'] } },
    };
    expect(pictureProgress(project, run)).toEqual({ done: 0, total: 1, refused: [], failed: [], working: [] });
    expect(runPhase(project, run)).toBe('idle');
    expect(Object.keys(sceneStatesFor(project, run))).toEqual(['s1']);
    expect(entryLabel(project, 'hero-sheet')).toBe('Model sheet');
    expect(entryLabel(project, 's1')).toBe('Scene 1');
    expect(entryLabel(project, null)).toBeNull();
    const step = { projectId: 'p1', sceneId: 'hero-sheet', text: 'Typing the prompt', target: 'prompt' as const, at: 0 };
    expect(liveView(run, step, project)).toMatchObject({ step: 'Model sheet · Typing the prompt', scene: null, savedCards: [] });
  });
});

describe('model sheet: fix round 1', () => {
  it('a paused sheet blocks other runs with its own message, and Stop frees them', async () => {
    const { coordinator, project, fakePort, store } = await withHero(1);
    const other = await store.createProject('Other');
    other.scenes = (await store.getProject(project.id))!.scenes;
    other.character = { description: HERO };
    await store.saveProject(other);
    coordinator.setFlowPort(fakePort({ confirmStarted: vi.fn(() => new Promise<boolean>(() => undefined)) }));
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => coordinator.getRunState()?.status === 'running');
    await expect(coordinator.startRun(other.id)).rejects.toThrow(coordinator.HERO_SHEET_BUSY_MESSAGE);
    await coordinator.pauseRun();
    await waitFor(() => coordinator.getRunState()?.status === 'paused');
    expect(coordinator.HERO_SHEET_PAUSED_MESSAGE).toBe('The model sheet is paused. Resume or stop it in the Script step, then try again.');
    await expect(coordinator.startRun(other.id)).rejects.toThrow(coordinator.HERO_SHEET_PAUSED_MESSAGE);
    await expect(coordinator.startHeroSheetRun(other.id)).rejects.toThrow(coordinator.HERO_SHEET_PAUSED_MESSAGE);
    await coordinator.stopRun();
    await coordinator.startRun(other.id);
    expect(coordinator.getRunState()!.projectId).toBe(other.id);
  });

  it('matches the sheet with the outputs and shape it was sent with, not later edits', async () => {
    const { coordinator, project, fakePort, store } = await withHero(2);
    stubFetch();
    const port = fakePort();
    let opened = '';
    vi.mocked(port.tilePoint).mockImplementation(async (_tab, key) => ((opened = key), { x: TILE_X, y: 300 }));
    coordinator.setFlowPort(port);
    await coordinator.startHeroSheetRun(project.id);
    await waitFor(() => coordinator.getRunState()?.sceneStates['hero-sheet']?.status === 'submitted');
    expect(coordinator.getRunState()!.sheet).toEqual({ outputs: 2, aspect: '9:16' });
    const prompt = vi.mocked(port.prepare).mock.calls[0]![2];
    vi.mocked(port.readDetail).mockImplementation(async () => ({ prompt, mediaId: opened }));

    // The owner changes the project's outputs and shape while Flow draws the sheet.
    const edited = (await store.getProject(project.id))!;
    edited.outputsPerPrompt = 1;
    edited.aspect = '1:1';
    await store.saveProject(edited);

    await coordinator.handleTiles([card('k1', 0)]);
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.sceneStates['hero-sheet']?.status).toBe('submitted'); // one of two isn't the sheet
    await coordinator.handleTiles([card('k2', 0), card('k1', 1)]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the sheet finished');
    expect(coordinator.getRunState()!.sceneStates['hero-sheet']?.pictureIds).toHaveLength(2);
    // The saved sheet keeps the shape it was drawn in, so the studio frames its pictures in it.
    await coordinator.settledForTests();
    expect((await store.getProject(project.id))!.heroSheet).toMatchObject({ status: 'done', aspect: '9:16' });
  });

  it('keeps the shape on the saved sheet from the moment it starts', async () => {
    const { coordinator, project, fakePort, store } = await withHero(2);
    stubFetch();
    coordinator.setFlowPort(fakePort());
    await coordinator.startHeroSheetRun(project.id);
    expect((await store.getProject(project.id))!.heroSheet?.aspect).toBe('9:16');
  });

  it('a sheet run restored after a restart sends the model sheet prompt, with no reference', async () => {
    const ctx = await withHero(1);
    const { initHeroSheetRun, reduceRun } = await import('../../src/runs/run');
    const project = (await ctx.store.getProject(ctx.project.id))!;
    // A running sheet run was saved; the browser restarted (no session marker).
    ctx.chromeMock.storage.local.data['vidflow.run'] = reduceRun(initHeroSheetRun(project), { type: 'start' });
    delete ctx.chromeMock.storage.session.data['vidflow.sessionAlive'];
    vi.resetModules();
    const store = await import('../../src/store/projects');
    store.setMediaStore(ctx.media);
    const coordinator = await loadCoordinator();
    const port = ctx.fakePort();
    coordinator.registerCoordinator();
    coordinator.setFlowPort(port);
    await waitFor(() => vi.mocked(port.prepare).mock.calls.length === 1, 'the sheet sent after restart');
    const [, sceneId, prompt, options] = vi.mocked(port.prepare).mock.calls[0]!;
    expect(sceneId).toBe('hero-sheet');
    expect(prompt).toMatch(/model sheet/i);
    expect(prompt).not.toMatch(/Ingredient|reference picture/i);
    expect(options).toEqual({ aspect: '9:16', outputs: 1, verb: 'Resume' });
    expect(port.uploadReference).not.toHaveBeenCalled();
  });
});

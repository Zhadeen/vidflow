import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';
import type { FlowResultCard } from '../../src/flow/driver';
import type { ClipOptions } from '../../src/flow/messages';
import type { Scene } from '../../src/scenes/types';
import type { Project } from '../../src/store/projects';
import { mp4Bytes } from '../motion/mp4Fixture';

const TILE_X = 50;
const GENERATE = { x: 120, y: 620 };
const PROJECT_URL = 'https://flow.google.com/u/0/project/3f1c2a9e-1111-4222-8333-944455556666';
const FIXED_LINE =
  'Keep the exact same drawing style and characters as the start frame; simple, gentle motion; no new objects, no text, no camera cuts.';

/** In-memory chrome APIs the coordinator touches (downloads included). The Flow tab starts on Flow's home page. */
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
    notifications: { create: vi.fn(async (_o: unknown) => '') },
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
    runtime: { id: 'vidflow-ext', onStartup: listener(), getURL: (p: string) => `chrome-extension://test/${p}` },
    downloads: {
      onCreated: listener(),
      cancel: vi.fn(async (_id: number) => undefined),
      search: vi.fn(async ({ id }: { id: number }) => [{ id, state: 'complete' }]),
      removeFile: vi.fn(async (_id: number) => undefined),
      erase: vi.fn(async ({ id }: { id: number }) => [id]),
    },
    debugger: {
      attach: vi.fn(async (_target: unknown) => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

const FAST = { paceMinMs: 1, paceMaxMs: 2, urlPollMs: 5, backWaitMs: 200, clipPollMs: 10 };

type Tile =
  | { kind: 'upload'; id: string; name: string }
  | {
      kind: 'clip';
      prompt: string;
      mediaId: string;
      done: boolean;
      refused?: string;
      detailPrompt?: string;
      showsFrame?: boolean;
      /** The start frame attached when it was made (its page never shows the name: spike S8, 6 Nov). */
      frame?: string;
      /** Flow left it out of the grid for a moment. */
      hidden?: boolean;
    };

/** The Flow tab's mocked chrome as it is now (a restart replaces it). */
const currentTab = () => (globalThis as unknown as { chrome: { tab: { url: string } } }).chrome.tab;

/**
 * A small Flow: uploads become picture tiles captioned with the file name, Generate adds a drawing clip, finish()
 * turns them into finished video tiles (keyed by grid position, no media id), which open to their detail page.
 */
function flowWorld() {
  const tiles: Tile[] = []; // oldest first
  let typed = '';
  let frame = '';
  const visible = () => [...tiles].reverse().filter((t) => !(t.kind === 'clip' && t.hidden));
  let opened: Extract<Tile, { kind: 'clip' }> | null = null;
  let made = 0;
  const world = {
    tiles,
    generates: 0,
    /** Set to refuse the next Generate (the tile keeps the prompt as caption). */
    refuseNext: null as string | null,
    cards(): FlowResultCard[] {
      return visible().map((t, domIndex): FlowResultCard => {
        if (t.kind === 'upload') {
          return { key: t.id, caption: t.name, imageUrl: `https://flow-content.google/image/${t.id}`, progress: null, refusal: null, domIndex };
        }
        if (t.refused) return { key: `pending-${domIndex}`, caption: t.prompt, imageUrl: null, progress: null, refusal: t.refused, domIndex };
        if (!t.done && t.showsFrame) {
          // Drawing, with its start frame shown and no percentage yet: it looks like a finished picture but for its caption.
          return { key: `frame-${t.mediaId}`, caption: t.prompt, imageUrl: `https://flow-content.google/image/f-${t.mediaId}`, progress: null, refusal: null, domIndex };
        }
        if (!t.done) return { key: `pending-${domIndex}`, caption: t.prompt, imageUrl: null, progress: 40, refusal: null, domIndex };
        return { key: `video-${domIndex}`, caption: 'Stickman waving', imageUrl: `https://flow.google.com/asb/tok-${t.mediaId}`, progress: null, refusal: null, domIndex, video: true };
      });
    },
    finish() {
      for (const t of tiles) if (t.kind === 'clip' && !t.refused) t.done = true;
    },
    clip(n: number) {
      return tiles.filter((t): t is Extract<Tile, { kind: 'clip' }> => t.kind === 'clip')[n - 1]!;
    },
    opened: [] as string[],
  };
  const port = {
    findNewProject: vi.fn(async () => ({ x: 5, y: 5 })),
    prepare: vi.fn(async () => ({ x: 1, y: 1 })),
    press: vi.fn(async (_tabId: number, x: number) => {
      if (x === 5) currentTab().url = PROJECT_URL;
      if (x === TILE_X) currentTab().url = `${PROJECT_URL}/edit/e-${opened?.mediaId ?? 'x'}`;
      if (x === GENERATE.x) {
        world.generates++;
        made++;
        tiles.push({ kind: 'clip', prompt: typed, frame, mediaId: `m${made}`, done: false, ...(world.refuseNext ? { refused: world.refuseNext } : {}) });
        world.refuseNext = null;
      }
    }),
    confirmStarted: vi.fn(async (): Promise<boolean | 'notice' | 'billing'> => true),
    tiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    tilePoint: vi.fn(async (_tabId: number, key: string) => {
      const i = world.cards().findIndex((c) => c.key === key);
      if (i < 0) throw new Error(`no tile ${key}`);
      world.opened.push(key);
      const t = visible()[i]!;
      opened = t.kind === 'clip' ? t : null;
      return { x: TILE_X, y: 300 };
    }),
    readDetail: vi.fn(async () => ({ prompt: null as string | null, mediaId: null as string | null })),
    uploadReference: vi.fn(async (): Promise<string | null> => 'ref'),
    acceptNotice: vi.fn(async (): Promise<boolean | null | 'gone'> => true),
    prepareClip: vi.fn(async (_tabId: number, prompt: string, options: ClipOptions) => {
      typed = prompt;
      frame = options.startFrame;
      return { ...GENERATE };
    }),
    uploadStartFrame: vi.fn(async (_tabId: number, name: string, _image: Blob) => {
      if (!tiles.some((t) => t.kind === 'upload' && t.name === name)) tiles.push({ kind: 'upload', id: `up-${name}`, name });
    }),
    generateCost: vi.fn(async (_tabId: number): Promise<number | null> => 7),
    creditBalance: vi.fn(async (_tabId: number) => ({ credits: 1000, resets: '13 Nov at 13:50' }) as { credits: number; resets: string | null } | null),
    videoTiles: vi.fn(async () => world.cards()),
    readVideoDetail: vi.fn(async () => ({
      prompt: opened ? (opened.detailPrompt ?? opened.prompt) : null,
      editId: opened ? `e-${opened.mediaId}` : null,
      // Flow's media rail lists the project's uploads by name on every clip page: a name there says nothing about
      // which clip this is. A port that passed one on must not change matching.
      startFrame: 'vidflow-s02.png' as string | null,
    })),
    clipFile: vi.fn(async () => (opened ? { url: `https://flow-content.google/video/${opened.mediaId}?Expires=1`, mediaId: opened.mediaId } : null)),
    prepareAgentQuestion: vi.fn(async () => ({ x: 9, y: 9 })),
    readAgentReply: vi.fn(async () => null),
    finishAgent: vi.fn(async () => true),
    askAgent: vi.fn(async () => null),
  };
  return { world, port };
}

const scene = (n: number, start: number | null, end: number | null, motionPrompt = `Slide ${n} moves gently`): Scene => ({
  id: `s${n}`,
  slide: n,
  start,
  end,
  sentence: `Sentence ${n}.`,
  concept: '',
  textOverlay: '',
  imagePrompt: `A stickman in scene ${n}`,
  motionPrompt,
  motionPromptIsDefault: false,
});

function stubFetch(duration = 4032) {
  const fetchMock = vi.fn(async (_url: string) => {
    const bytes = mp4Bytes({ duration, timescale: 1000 });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      blob: async () => new Blob([bytes], { type: 'video/mp4' }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Every coordinator a test loaded; each is stopped afterwards so it can't act on the next test's chrome. */
const live: (typeof import('../../src/runs/coordinator'))[] = [];

async function setup(opts: { aspect?: Project['aspect']; picks?: string[]; scenes?: Scene[]; mode?: Project['motionMode'] } = {}) {
  vi.resetModules();
  const chromeMock = mockChrome();
  const store = await import('../../src/store/projects');
  const media = memoryMediaStore();
  store.setMediaStore(media);
  const coordinator = await import('../../src/runs/coordinator');
  coordinator.setTimingsForTests(FAST);
  live.push(coordinator);
  coordinator.registerCoordinator();
  const project = await store.createProject('Demo');
  project.aspect = opts.aspect ?? '16:9';
  project.outputsPerPrompt = 2;
  project.scenes = opts.scenes ?? [scene(1, 0, 2.4), scene(2, 2.4, 5), scene(3, 5, 10)];
  project.motionMode = opts.mode ?? 'picked';
  project.clipPicks = opts.picks ?? project.scenes.map((s) => s.id);
  for (const [i, s] of project.scenes.entries()) {
    const nn = String(i + 1).padStart(2, '0');
    const a = await media.put(project.id, `scene-${nn}-option-1`, new Blob([`picture ${s.id} a`], { type: 'image/png' }));
    const b = await media.put(project.id, `scene-${nn}-option-2`, new Blob([`picture ${s.id} b`], { type: 'image/png' }));
    project.sceneStates[s.id] = { sceneId: s.id, status: 'done', pictureIds: [a, b], cardKeys: [`k-${s.id}-a`, `k-${s.id}-b`] };
  }
  await store.saveProject(project);
  const { world, port } = flowWorld();
  return { chromeMock, coordinator, project, media, store, world, port };
}

/** Polls until `check` holds; throws with `what` after 5 s. */
async function waitFor(check: () => boolean | Promise<boolean>, what = 'the expected state') {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after 5 s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The listener the coordinator registered on a mocked chrome event. */
function listenerOf<T extends (...args: never[]) => unknown>(event: { addListener: { mock: { calls: unknown[][] } } }): T {
  const calls = event.addListener.mock.calls;
  return calls[calls.length - 1]![0] as T;
}

const activity = (chromeMock: ReturnType<typeof mockChrome>) =>
  ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as Array<{ text: string; sceneId: string | null }>).map((e) => e.text);

beforeEach(() => vi.unstubAllGlobals());
afterEach(async () => {
  for (const c of live.splice(0)) await c.stopRun().catch(() => undefined);
});

describe('Motion run (clips)', () => {
  it('makes a clip per picked slide in a fresh Flow project with Video · Frames · aspect · 720p · length · x1', async () => {
    const { coordinator, project, port, world } = await setup({ picks: ['s1', 's3'] });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');

    // A fresh Flow project first (New project pressed), then one clip per picked slide.
    expect(port.findNewProject).toHaveBeenCalledWith(7, 'Resume');
    expect(port.press.mock.calls[0]).toEqual([7, 5, 5]);
    const run = coordinator.getRunState()!;
    expect(run.kind).toBe('clips');
    expect(run.flowProjectUrl).toBe(PROJECT_URL);
    expect(Object.keys(run.sceneStates).sort()).toEqual(['s1', 's3']);
    // The settings: the video's aspect, each slide's own length (2.4 s → 4 s, 5 s → 6 s); prepareClip sets
    // Video · Frames · 720p · x1 itself (Task 3).
    expect(port.prepareClip.mock.calls.map(([, , o]) => o)).toEqual([
      { aspect: '16:9', length: 4, startFrame: 'vidflow-s01.png', verb: 'Resume' },
      { aspect: '16:9', length: 6, startFrame: 'vidflow-s03.png', verb: 'Resume' },
    ]);
    // The balance is read once, before the first clip; the cost before every Generate; nothing pictures-only is used.
    expect(port.creditBalance).toHaveBeenCalledTimes(1);
    expect(port.generateCost).toHaveBeenCalledTimes(2);
    expect(port.prepare).not.toHaveBeenCalled();
    expect(port.uploadReference).not.toHaveBeenCalled();
    expect(coordinator.getRunState()!.spent).toBe(14);
    expect(coordinator.getRunState()!.limit).toBe(100);
  });

  it('uploads the chosen picture as vidflow-sNN.png and attaches it to Start', async () => {
    const { coordinator, project, port, world, media, store } = await setup({ picks: ['s2'] });
    const saved = (await store.getProject(project.id))!;
    const chosen = saved.sceneStates.s2!.pictureIds[1]!;
    saved.sceneStates.s2 = { ...saved.sceneStates.s2!, chosenPictureId: chosen, choiceSource: 'owner' };
    await store.saveProject(saved);
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'the clip pressed');

    expect(port.uploadStartFrame).toHaveBeenCalledTimes(1);
    const [tabId, name, blob] = port.uploadStartFrame.mock.calls[0]!;
    expect(tabId).toBe(7);
    expect(name).toBe('vidflow-s02.png');
    expect(await blob.text()).toBe(await (await media.get(chosen))!.text());
    // Attached to Start by that name, after the upload, before Generate.
    expect(port.prepareClip.mock.calls[0]![2].startFrame).toBe('vidflow-s02.png');
    expect(port.uploadStartFrame.mock.invocationCallOrder[0]!).toBeLessThan(port.prepareClip.mock.invocationCallOrder[0]!);
    expect(coordinator.getRunState()!.clips?.s2?.pictureId).toBe(chosen);
  });

  it('motion prompt = slide motion prompt + the fixed line', async () => {
    const { coordinator, project, port, world } = await setup({ scenes: [scene(1, 0, 3), scene(2, 3, 6, '')] });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');
    const prompts = port.prepareClip.mock.calls.map(([, prompt]) => prompt);
    expect(prompts[0]).toBe(`Slide 1 moves gently ${FIXED_LINE}`);
    // No motion prompt: the default one from the slide's picture prompt.
    expect(prompts[1]).toBe(`Gentle, natural movement: A stickman in scene 2 ${FIXED_LINE}`);
  });

  it('stops before a clip that would pass the limit', async () => {
    const { coordinator, project, port, world, store, chromeMock } = await setup();
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 10);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'failed', 's2 not made');
    expect(world.generates).toBe(1);
    expect(coordinator.getRunState()!.spent).toBe(7);
    // The first clip still comes in; then the run finishes (not paused).
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip).toBeDefined();
    expect(saved.sceneStates.s2!.clipNote).toBe('Not made — credit limit');
    expect(saved.sceneStates.s3!.clipNote).toBe('Not made — credit limit');
    expect(saved.sceneStates.s2!.clip).toBeUndefined();
    // Their pictures are untouched.
    expect(saved.sceneStates.s2!.status).toBe('done');
    expect(saved.sceneStates.s2!.pictureIds).toHaveLength(2);
    expect(world.generates).toBe(1);
    expect(activity(chromeMock).some((t) => /Finished/.test(t))).toBe(true);
  });

  it('stops before passing the balance', async () => {
    const { coordinator, project, port, world, store } = await setup();
    port.creditBalance.mockResolvedValue({ credits: 10, resets: null });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s3?.status === 'failed', 'the rest not made');
    expect(world.generates).toBe(1);
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s2!.clipNote).toBe('Not made — not enough Flow credits');
    expect(saved.sceneStates.s3!.clipNote).toBe('Not made — not enough Flow credits');
  });

  it('every pressed Generate counts, even refused', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1', 's2'] });
    world.refuseNext = "Flow couldn't make this clip.";
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 10);
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    const run = coordinator.getRunState()!;
    expect(run.sceneStates.s1!.status).toBe('refused');
    // Refused, but it was pressed: 7 of 10 spent, so the next 7-credit clip would pass the limit.
    expect(run.spent).toBe(7);
    expect(world.generates).toBe(1);
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clipNote).toBe("Flow couldn't make this clip.");
    expect(saved.sceneStates.s2!.clipNote).toBe('Not made — credit limit');
  });

  it('saves scene-NN-clip.mp4 with measured length and use range', async () => {
    const { coordinator, project, port, world, store, media, chromeMock } = await setup({ picks: ['s1'] });
    const fetchMock = stubFetch(4032);
    const before = (await store.getProject(project.id))!;
    before.sceneStates.s1 = { ...before.sceneStates.s1!, clipNote: 'Not made — credit limit' };
    await store.saveProject(before);
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'the clip pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();

    expect(fetchMock).toHaveBeenCalledWith('https://flow-content.google/video/m1?Expires=1');
    const saved = (await store.getProject(project.id))!;
    const s1 = saved.sceneStates.s1!;
    expect(s1.clip).toEqual({
      mediaId: `${project.id}/scene-01-clip.mp4`,
      sourcePictureId: before.sceneStates.s1!.pictureIds[0],
      length: 4.032,
      use: [0, 2.4],
      flowMediaId: 'm1',
    });
    expect(s1.clipNote).toBeUndefined();
    // The slide's pictures and their status stay as they were.
    expect(s1.status).toBe('done');
    expect(s1.pictureIds).toEqual(before.sceneStates.s1!.pictureIds);
    expect(s1.cardKeys).toEqual(before.sceneStates.s1!.cardKeys);
    const file = await media.get(`${project.id}/scene-01-clip.mp4`);
    expect(file?.type).toBe('video/mp4');
    expect(file?.size).toBeGreaterThan(100);
    const log = activity(chromeMock);
    expect(log).toContain('Making clip');
    expect(log.some((t) => /^Checking clip 1 matches/.test(t))).toBe(true);
    expect(log).toContain('✓ Saved clip');
  });

  it('matching uses order + media id + detail prompt, uploads excluded', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1', 's2'] });
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    // The uploaded start frames are picture tiles captioned with their file name: never opened.
    expect(world.opened.every((k) => k.startsWith('video-'))).toBe(true);
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
    expect(saved.sceneStates.s2!.clip?.flowMediaId).toBe('m2');
  });

  it('a drawing clip that shows its start frame keeps its place (it is no upload)', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1', 's2'] });
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');
    world.clip(1).showsFrame = true;
    world.clip(2).done = true; // the second clip finishes first
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'done', 's2 saved');
    expect(coordinator.getRunState()!.sceneStates.s1!.status).toBe('submitted');
    world.clip(1).done = true;
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
    expect(saved.sceneStates.s2!.clip?.flowMediaId).toBe('m2');
  });

  it('never saves a clip whose detail prompt is not the slide’s', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1'] });
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'the clip pressed');
    world.clip(1).detailPrompt = 'Someone else’s clip entirely';
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => port.readVideoDetail.mock.calls.length > 0, 'the clip checked');
    await coordinator.settledForTests();
    expect(port.clipFile).not.toHaveBeenCalled();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip).toBeUndefined();
    expect(coordinator.getRunState()!.sceneStates.s1!.status).not.toBe('done');
  });

  it("never saves the same Flow clip (media id) for two slides", async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1', 's2'], scenes: [scene(1, 0, 3, 'Same'), scene(2, 3, 6, 'Same')] });
    stubFetch();
    // Flow hands back the same file whichever tile is opened.
    port.clipFile.mockImplementation(async () => ({ url: 'https://flow-content.google/video/m1?Expires=1', mediaId: 'm1' }));
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 saved');
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
    expect(saved.sceneStates.s2!.clip).toBeUndefined();
  });

  it("cancels and erases Flow's own browser download of the clip", async () => {
    const { coordinator, project, port, world, chromeMock } = await setup({ picks: ['s1'] });
    stubFetch();
    const onCreated = listenerOf<(item: chrome.downloads.DownloadItem) => void>(chromeMock.downloads.onCreated);
    port.clipFile.mockImplementation(async () => {
      onCreated({ id: 9, url: 'https://flow-content.google/video/m1?Expires=1', finalUrl: 'https://flow-content.google/video/m1?Expires=1', referrer: '', filename: 'Stickman waving_m1.mp4', mime: 'video/mp4', state: 'complete' } as chrome.downloads.DownloadItem);
      return { url: 'https://flow-content.google/video/m1?Expires=1', mediaId: 'm1' };
    });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'the clip pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => chromeMock.downloads.erase.mock.calls.length > 0, 'the download erased');
    expect(chromeMock.downloads.removeFile).toHaveBeenCalledWith(9);
    expect(chromeMock.downloads.erase).toHaveBeenCalledWith({ id: 9 });
  });

  it('pause/resume/stop/skip work', async () => {
    const { coordinator, project, port, world, chromeMock } = await setup({ picks: ['s1', 's2', 's3'] });
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    const typing = vi.fn();
    port.prepareClip.mockImplementation(async (_tab, prompt) => {
      typing(prompt);
      await gate;
      return { ...GENERATE };
    });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => typing.mock.calls.length === 1, 's1 typed');

    // Pause while the clip is being set up: Generate is never pressed, nothing is spent.
    await coordinator.pauseRun();
    release();
    await coordinator.settledForTests();
    expect(coordinator.getRunState()!.status).toBe('paused');
    expect(world.generates).toBe(0);
    expect(coordinator.getRunState()!.spent).toBe(0);

    // Resume: s1 goes. Hold s2 while it is being typed, then skip it.
    gate = Promise.resolve();
    port.prepareClip.mockImplementation(async (_tab, prompt) => {
      typing(prompt);
      if (/Slide 2/.test(prompt)) await new Promise<void>((r) => (release = r));
      return { ...GENERATE };
    });
    await coordinator.resumeRun();
    await waitFor(() => coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 sent');
    await waitFor(() => typing.mock.calls.some(([p]) => /Slide 2/.test(p as string)), 's2 typed');
    await coordinator.skipCurrent();
    release();
    await waitFor(() => coordinator.getRunState()?.sceneStates.s3?.status === 'submitted', 's3 sent');
    expect(coordinator.getRunState()!.sceneStates.s2).toMatchObject({ status: 'failed', message: 'Skipped by you' });
    expect(world.generates).toBe(2);
    expect(coordinator.getRunState()!.spent).toBe(14);

    // Stop: the run ends; nothing more is sent; the slides' pictures stay.
    await coordinator.stopRun();
    expect(coordinator.getRunState()!.status).toBe('idle');
    expect(activity(chromeMock)).toContain('Paused by you');
  });

  it('refuses while another run is live', async () => {
    const { coordinator, project, port, store } = await setup();
    const { RunBlockedError } = await import('../../src/runs/coordinator');
    const withHero = (await store.getProject(project.id))!;
    withHero.character = { description: 'A tall stickman' };
    // Slide 3's pictures failed last time: a picture run has it to make (its older pictures can still be clipped).
    withHero.sceneStates.s3 = { ...withHero.sceneStates.s3!, status: 'failed', message: 'Try again' };
    await store.saveProject(withHero);
    // A picture run is live (typing is held): Make clips waits.
    let release!: () => void;
    port.prepare.mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      return { x: 1, y: 1 };
    });
    coordinator.setFlowPort(port);
    await coordinator.startRun(project.id);
    await waitFor(() => port.prepare.mock.calls.length > 0, 'the picture run typing');
    await expect(coordinator.startClipRun(project.id, 100)).rejects.toBeInstanceOf(RunBlockedError);
    await coordinator.stopRun();
    release(); // stopped meanwhile: nothing is pressed
    await coordinator.settledForTests();

    // A clip run is live: Start, the model sheet and another Make clips wait.
    port.prepareClip.mockImplementation(() => new Promise(() => undefined));
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => port.prepareClip.mock.calls.length > 0, 'the clip run typing');
    await expect(coordinator.startRun(project.id)).rejects.toBeInstanceOf(RunBlockedError);
    await expect(coordinator.startHeroSheetRun(project.id)).rejects.toBeInstanceOf(RunBlockedError);
    const other = await store.createProject('Other');
    await expect(coordinator.startClipRun(other.id, 100)).rejects.toBeInstanceOf(RunBlockedError);
    expect(coordinator.getRunState()!.kind).toBe('clips');
  });

  it('1:1 video refused with the plain reason', async () => {
    const { coordinator, project, port } = await setup({ aspect: '1:1' });
    coordinator.setFlowPort(port);
    await expect(coordinator.startClipRun(project.id, 100)).rejects.toThrow('Flow makes clips only for 16:9 and 9:16 videos.');
    expect(coordinator.getRunState()).toBeNull();
    expect(port.findNewProject).not.toHaveBeenCalled();
  });

  it('a restart never pays twice: the clip in Flow is looked for before any press, then collected', async () => {
    const ctx = await setup({ picks: ['s1'] });
    stubFetch();
    ctx.coordinator.setFlowPort(ctx.port);
    await ctx.coordinator.startClipRun(ctx.project.id, 100);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 in Flow');
    // The browser restarts: the saved run comes back in a fresh worker (no session marker).
    const saved = structuredClone(ctx.chromeMock.storage.local.data);
    await ctx.coordinator.stopRun(); // the old worker is gone (stopping it here only keeps it from acting)
    vi.resetModules();
    const chrome2 = mockChrome();
    Object.assign(chrome2.storage.local.data, saved);
    const store2 = await import('../../src/store/projects');
    store2.setMediaStore(ctx.media);
    const c2 = await import('../../src/runs/coordinator');
    c2.setTimingsForTests(FAST);
    live.push(c2);
    c2.registerCoordinator();
    c2.setFlowPort(ctx.port);
    await waitFor(() => !!c2.getRunState()?.sceneStates.s1?.unconfirmed, 's1 waiting to be found');
    ctx.world.finish();
    await c2.handleTiles([]);
    await waitFor(() => c2.getRunState()?.status === 'finished', 'the run finished');
    await c2.settledForTests();
    expect(ctx.world.generates).toBe(1);
    expect(c2.getRunState()!.spent).toBe(7);
    const project = (await store2.getProject(ctx.project.id))!;
    expect(project.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
  });

  it('a tile that briefly disappears loses no slide, and each slide gets its own clip', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1', 's2'] });
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 2, 'two clips pressed');
    world.finish();
    world.clip(1).hidden = true; // Flow redraws: the older clip is missing for a moment
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.sceneStates.s2?.status === 'done', 's2 saved');
    world.clip(1).hidden = false;
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(saved.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
    expect(saved.sceneStates.s2!.clip?.flowMediaId).toBe('m2');
  });

  it('slides with the same motion prompt each get the clip from their own press, by order', async () => {
    const { coordinator, project, port, world, store } = await setup({
      picks: ['s1', 's2', 's3'],
      scenes: [scene(1, 0, 3, 'Same'), scene(2, 3, 6, 'Same'), scene(3, 6, 9, 'Same')],
    });
    stubFetch();
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 3, 'three clips pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    const saved = (await store.getProject(project.id))!;
    expect(['s1', 's2', 's3'].map((id) => saved.sceneStates[id]!.clip?.flowMediaId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('Stop arriving right before the press: nothing is pressed and nothing is spent', async () => {
    const { coordinator, project, port, world, chromeMock } = await setup({ picks: ['s1'] });
    let stopped = false;
    const get = chromeMock.tabs.get.getMockImplementation()!;
    chromeMock.tabs.get.mockImplementation(async () => {
      // The first look at the tab after the press was recorded is the one right before pressing.
      if (!stopped && coordinator.getRunState()?.sceneStates.s1?.unconfirmed) {
        stopped = true;
        await coordinator.stopRun();
      }
      return get();
    });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => stopped, 'stopped at the press');
    await coordinator.settledForTests();
    expect(world.generates).toBe(0);
    expect(coordinator.getRunState()!.status).toBe('idle');
    expect(coordinator.getRunState()!.spent).toBe(0);
  });

  it('a press that throws pauses the run with the slide waiting to be found, never failed', async () => {
    const { coordinator, project, port, world } = await setup({ picks: ['s1'] });
    const press = port.press.getMockImplementation()!;
    port.press.mockImplementation(async (tabId: number, x: number) => {
      if (x === GENERATE.x) throw new Error('Debugger is not attached');
      return press(tabId, x);
    });
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => coordinator.getRunState()?.status === 'paused', 'paused');
    const s1 = coordinator.getRunState()!.sceneStates.s1!;
    expect(s1.status).toBe('pending');
    expect(s1.unconfirmed).toBeDefined();
    expect(coordinator.getRunState()!.pauseReason).toMatch(/clip/);
    expect(world.generates).toBe(0);
  });

  it('a failed fetch opens the clip page again for a fresh address, then saves', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1'] });
    const ok = stubFetch();
    const okImpl = ok.getMockImplementation()!;
    let calls = 0;
    ok.mockImplementation(async (url: string) => (++calls === 1 ? ({ ok: false, status: 403 } as never) : okImpl(url)));
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    expect(port.clipFile).toHaveBeenCalledTimes(2);
    expect((await store.getProject(project.id))!.sceneStates.s1!.clip?.flowMediaId).toBe('m1');
  });

  it('a clip that still cannot be saved says what making it again costs', async () => {
    const { coordinator, project, port, world, store } = await setup({ picks: ['s1'] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    await waitFor(() => world.generates === 1, 'pressed');
    world.finish();
    await coordinator.handleTiles([]);
    await waitFor(() => coordinator.getRunState()?.status === 'finished', 'the run finished');
    await coordinator.settledForTests();
    expect(port.clipFile).toHaveBeenCalledTimes(2);
    expect((await store.getProject(project.id))!.sceneStates.s1!.clipNote).toBe("Couldn't save this clip. Making it again costs 7 credits.");
  });

  it("logs Flow's announcement and a panel left open in the run's activity", async () => {
    const { coordinator, project, port, chromeMock } = await setup({ picks: ['s1'] });
    port.prepareClip.mockImplementation(() => new Promise(() => undefined));
    coordinator.setFlowPort(port);
    await coordinator.startClipRun(project.id, 100);
    coordinator.noteFlowTab("Closed Flow's announcement");
    await waitFor(() => activity(chromeMock).includes("Closed Flow's announcement"), 'the line logged');
  });
});

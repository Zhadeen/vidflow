import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';
import type { FlowResultCard } from '../../src/flow/driver';
import type { Scene } from '../../src/scenes/types';
import type { SceneState } from '../../src/store/projects';
import {
  AUTO_PICK_GAVE_UP_MESSAGE,
  AUTO_PICK_QUESTION,
  AUTO_PICK_REPLY_MS,
  isComparisonUpload,
  parseAgentAnswer,
} from '../../src/runs/autopick';

const TILE_X = 50;
const NEW_PROJECT = { x: 5, y: 5 };
const GENERATE = { x: 120, y: 620 };
const AGENT_SEND = { x: 9, y: 9 };
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
    debugger: {
      attach: vi.fn(async (_target: unknown) => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

const FAST = { paceMinMs: 1, paceMaxMs: 2, urlPollMs: 5, backWaitMs: 200, clipPollMs: 10, agentReplyMs: 60, agentSliceMs: 20 };

const scene = (n: number): Scene => ({
  id: `s${n}`,
  slide: n,
  start: null,
  end: null,
  sentence: `Sentence ${n}.`,
  concept: '',
  textOverlay: '',
  imagePrompt: `A stickman in scene ${n}`,
  motionPrompt: '',
  motionPromptIsDefault: true,
});

/**
 * A fake Flow port: picture runs (one tile per prompt output, checked on its detail page), comparison uploads, and the
 * Agent (answers from `replies`, one per question in order; null = no answer in the time asked).
 */
function fakePort(chromeMock: ReturnType<typeof mockChrome>) {
  const uploads: string[] = [];
  const agent = {
    replies: [] as Array<string | null>,
    open: false,
    questions: [] as Array<{ names: string[]; question: string }>,
    /** Set to hold the next reply until released. */
    hold: null as Promise<void> | null,
  };
  let opened = '';
  let typed = '';
  const port = {
    findNewProject: vi.fn(async () => ({ ...NEW_PROJECT })),
    prepare: vi.fn(async (_tab: number, _sceneId: string, prompt: string) => ((typed = prompt), { ...GENERATE })),
    press: vi.fn(async (_tabId: number, x: number, _y: number) => {
      if (x === NEW_PROJECT.x) chromeMock.tab.url = PROJECT_URL;
      if (x === TILE_X) chromeMock.tab.url = `${PROJECT_URL}/edit/gen-${opened}`;
    }),
    confirmStarted: vi.fn(async (): Promise<boolean | 'notice' | 'billing'> => true),
    tiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    tilePoint: vi.fn(async (_tab: number, key: string) => ((opened = key), { x: TILE_X, y: 300 })),
    readDetail: vi.fn(async () => ({ prompt: typed as string | null, mediaId: opened as string | null })),
    uploadReference: vi.fn(async (): Promise<string | null> => 'ref'),
    acceptNotice: vi.fn(async (): Promise<boolean | null | 'gone'> => true),
    prepareClip: vi.fn(async () => ({ ...GENERATE })),
    uploadStartFrame: vi.fn(async (_tabId: number, name: string, _image: Blob) => void uploads.push(name)),
    generateCost: vi.fn(async (): Promise<number | null> => 7),
    creditBalance: vi.fn(async () => ({ credits: 1000, resets: null }) as { credits: number; resets: string | null } | null),
    videoTiles: vi.fn(async (): Promise<FlowResultCard[]> => []),
    readVideoDetail: vi.fn(async () => ({ prompt: null, editId: null, startFrame: null })),
    clipFile: vi.fn(async () => null),
    prepareAgentQuestion: vi.fn(async (_tabId: number, names: string[], question: string) => {
      agent.open = true;
      agent.questions.push({ names, question });
      return { ...AGENT_SEND };
    }),
    readAgentReply: vi.fn(async (_tabId: number, timeoutMs: number): Promise<string | null> => {
      if (agent.hold) await agent.hold;
      const reply = agent.replies[agent.questions.length - 1] ?? null;
      if (reply === null) await new Promise((r) => setTimeout(r, timeoutMs)); // no answer within the time asked
      return reply;
    }),
    finishAgent: vi.fn(async () => ((agent.open = false), true)),
    askAgent: vi.fn(async () => null),
  };
  return { port, uploads, agent };
}

/** Every coordinator a test loaded; each is stopped afterwards so it can't act on the next test's chrome. */
const live: (typeof import('../../src/runs/coordinator'))[] = [];

/**
 * A project whose slides already have pictures (`pictures` per slide, 0 = none yet). States can be overridden per
 * slide (e.g. an owner's choice).
 */
async function setup(opts: { slides?: number; pictures?: number; states?: Record<string, Partial<SceneState>> } = {}) {
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
  project.aspect = '16:9';
  project.outputsPerPrompt = 2;
  project.scenes = Array.from({ length: opts.slides ?? 3 }, (_, i) => scene(i + 1));
  const count = opts.pictures ?? 2;
  for (const [i, s] of project.scenes.entries()) {
    const nn = String(i + 1).padStart(2, '0');
    const ids: string[] = [];
    for (let k = 1; k <= count; k++) ids.push(await media.put(project.id, `scene-${nn}-option-${k}`, new Blob([`picture ${s.id} ${k}`], { type: 'image/png' })));
    if (count > 0) project.sceneStates[s.id] = { sceneId: s.id, status: 'done', pictureIds: ids, ...opts.states?.[s.id] };
  }
  await store.saveProject(project);
  const fake = fakePort(chromeMock);
  coordinator.setFlowPort(fake.port);
  const saved = async () => (await store.getProject(project.id))!;
  return { chromeMock, coordinator, project, media, store, saved, ...fake };
}

/** Polls until `check` holds; throws with `what` after 5 s. */
async function waitFor(check: () => boolean | Promise<boolean>, what = 'the expected state') {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after 5 s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function listenerOf<T extends (...args: never[]) => unknown>(event: { addListener: { mock: { calls: unknown[][] } } }): T {
  const calls = event.addListener.mock.calls;
  return calls[calls.length - 1]![0] as T;
}

const activity = (chromeMock: ReturnType<typeof mockChrome>) =>
  ((chromeMock.storage.local.data['vidflow.activity'] ?? []) as Array<{ text: string }>).map((e) => e.text);

/** Settles each submitted scene of a picture run: Flow shows two finished tiles per prompt, checked on their page. */
async function finishPictures(ctx: Awaited<ReturnType<typeof setup>>, sceneIds: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`], { type: 'image/png' }) })),
  );
  for (const id of sceneIds) {
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates[id]?.status === 'submitted', `${id} submitted`);
    const prompt = vi.mocked(ctx.port.prepare).mock.calls.filter((c) => c[1] === id).at(-1)![2];
    vi.mocked(ctx.port.readDetail).mockImplementation(async () => ({ prompt, mediaId: (ctx.port.tilePoint.mock.calls.at(-1)?.[1] as string) ?? null }));
    // Only this scene's tiles (any other scene still in Flow has none yet).
    await ctx.coordinator.handleTiles([card(`${id}-k2`, 0), card(`${id}-k1`, 1)]);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates[id]?.status === 'done', `${id} done`);
  }
}

const card = (key: string, domIndex: number, caption = `Stickman ${key}`): FlowResultCard => ({
  key,
  caption,
  imageUrl: `https://flow-content.google/image/${key}`,
  progress: null,
  refusal: null,
  domIndex,
});

beforeEach(() => vi.unstubAllGlobals());
afterEach(async () => {
  for (const c of live.splice(0)) await c.stopRun().catch(() => undefined);
});

describe('parseAgentAnswer', () => {
  it('parseAgentAnswer accepts "2 — shows the shoulder bag" and rejects "Both are good" / "3" when count is 2', () => {
    expect(parseAgentAnswer('2 — shows the shoulder bag', 2)).toEqual({ pick: 2, reason: 'shows the shoulder bag' });
    expect(parseAgentAnswer('  1. The close-up with bottles.', 2)).toEqual({ pick: 1, reason: 'The close-up with bottles.' });
    expect(parseAgentAnswer('1) strap across her body', 2)).toEqual({ pick: 1, reason: 'strap across her body' });
    expect(parseAgentAnswer('2: moon window', 2)).toEqual({ pick: 2, reason: 'moon window' });
    expect(parseAgentAnswer('2', 2)).toEqual({ pick: 2, reason: '' });
    expect(parseAgentAnswer('3 - third one', 4)).toEqual({ pick: 3, reason: 'third one' });
    for (const bad of ['Both are good', '3', '1 or 2', '12', '1-2', '1, 2', '0', 'Image 2 is better', '', '2nd one']) {
      expect(parseAgentAnswer(bad, 2), bad).toBeNull();
    }
    expect(parseAgentAnswer(`1 ${'x'.repeat(300)}`, 2)!.reason.length).toBeLessThanOrEqual(140);
  });

  it('asks the S6 question: "1 or 2" for two pictures, "1 to N" for more', () => {
    expect(AUTO_PICK_QUESTION('A stickman counts coins', 2)).toBe(
      'Text answer only, don\'t create anything. Image 1 is the first attachment, image 2 the second. Which better matches this scene: "A stickman counts coins"? Answer with just 1 or 2, then a short reason.',
    );
    const three = AUTO_PICK_QUESTION('A stickman counts coins', 3);
    expect(three).toMatch(/^Text answer only, don't create anything\. Image 1 .*image 3 .*in the order attached/);
    expect(three).toContain('"A stickman counts coins"');
    expect(three).toMatch(/Answer with just one number from 1 to 3, then a short reason\.$/);
    expect(AUTO_PICK_REPLY_MS).toBe(90_000);
  });
});

describe('settings', () => {
  it('Auto-pick is on by default and its switch is saved', async () => {
    mockChrome();
    const { getAutoPick, setAutoPick } = await import('../../src/settings');
    expect(await getAutoPick()).toBe(true);
    await setAutoPick(false);
    expect(await getAutoPick()).toBe(false);
    expect((globalThis as unknown as { chrome: ReturnType<typeof mockChrome> }).chrome.storage.local.data['vidflow.autoPick']).toBe(false);
  });
});

describe('RunClient.autoPick', () => {
  it('asks the background to Auto-pick this project', async () => {
    const sendMessage = vi.fn(async (_m: unknown) => ({ ok: true, state: null }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const { chromeRunClient } = await import('../../src/studio/runClient');
    expect(await chromeRunClient().autoPick('p1')).toEqual({ ok: true, state: null });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'run/auto-pick', projectId: 'p1' });
  });
});

describe('Auto-pick run', () => {
  it('runs after a whole-video picture run when the switch is on, not after ▶ Run / Retry / model sheet', async () => {
    // A whole-video picture run, switch on (default): Auto-pick follows on its own.
    {
      const ctx = await setup({ slides: 1, pictures: 0 });
      ctx.agent.replies = ['2 — shows the shoulder bag'];
      await ctx.coordinator.startRun(ctx.project.id);
      await finishPictures(ctx, ['s1']);
      await waitFor(() => ctx.agent.questions.length === 1, 'the Agent asked');
      await waitFor(async () => (await ctx.saved()).sceneStates.s1?.choiceSource === 'auto', 'the pick saved');
      expect(ctx.coordinator.getRunState()?.kind).toBe('auto-pick');
    }
    // Switch off: nothing follows.
    {
      const ctx = await setup({ slides: 1, pictures: 0 });
      ctx.chromeMock.storage.local.data['vidflow.autoPick'] = false;
      await ctx.coordinator.startRun(ctx.project.id);
      await finishPictures(ctx, ['s1']);
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the picture run finished');
      await ctx.coordinator.settledForTests();
      expect(ctx.port.prepareAgentQuestion).not.toHaveBeenCalled();
      expect(ctx.coordinator.getRunState()?.kind).toBeUndefined();
    }
    // ▶ Run on one slide (no run of this video): no Auto-pick afterwards.
    {
      const ctx = await setup({ slides: 2, pictures: 2, states: { s1: { status: 'failed', pictureIds: [], message: 'x' } } });
      await ctx.coordinator.retryScene(ctx.project.id, 's1');
      await finishPictures(ctx, ['s1']);
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the one-slide run finished');
      await ctx.coordinator.settledForTests();
      expect(ctx.port.prepareAgentQuestion).not.toHaveBeenCalled();
    }
    // Retry failed in a finished whole-video run: no Auto-pick after it (the whole run itself had the switch off).
    {
      const ctx = await setup({ slides: 2, pictures: 0 });
      ctx.chromeMock.storage.local.data['vidflow.autoPick'] = false;
      await ctx.coordinator.startRun(ctx.project.id);
      await finishPictures(ctx, ['s1']);
      await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s2?.status === 'submitted', 's2 submitted');
      await listenerOf<(a: { name: string }) => void>(ctx.chromeMock.alarms.onAlarm)({ name: 'vidflow-deadline:s2' });
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the whole run finished with s2 failed');
      ctx.chromeMock.storage.local.data['vidflow.autoPick'] = true;
      await ctx.coordinator.retryScene(ctx.project.id, 's2');
      await finishPictures(ctx, ['s2']);
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the retry finished');
      await ctx.coordinator.settledForTests();
      expect(ctx.port.prepareAgentQuestion).not.toHaveBeenCalled();
    }
    // The model sheet: no Auto-pick afterwards.
    {
      const ctx = await setup({ slides: 1, pictures: 2 });
      const p = await ctx.saved();
      p.character = { description: 'A stickman with a shoulder bag' };
      await ctx.store.saveProject(p);
      await ctx.coordinator.startHeroSheetRun(ctx.project.id);
      await finishPictures(ctx, ['hero-sheet']);
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the sheet finished');
      await ctx.coordinator.settledForTests();
      expect(ctx.port.prepareAgentQuestion).not.toHaveBeenCalled();
    }
  });

  it('sets choiceSource auto and the reason', async () => {
    const ctx = await setup({ slides: 1 });
    ctx.agent.replies = ['2 — shows the shoulder bag'];
    const before = (await ctx.saved()).sceneStates.s1!;
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    const s1 = (await ctx.saved()).sceneStates.s1!;
    expect(s1.chosenPictureId).toBe(before.pictureIds[1]);
    expect(s1.choiceSource).toBe('auto');
    expect(s1.autoReason).toBe('shows the shoulder bag');
    expect(s1.autoChecked).toBe(true);
    // Its pictures were uploaded under unique names and attached in that order, with the S6 question.
    expect(ctx.uploads).toEqual(['vidflow-s01-a.png', 'vidflow-s01-b.png']);
    expect(ctx.agent.questions).toEqual([{ names: ['vidflow-s01-a.png', 'vidflow-s01-b.png'], question: AUTO_PICK_QUESTION('A stickman in scene 1', 2) }]);
    // The uploads are this slide's own pictures, in pictureIds order.
    const blobs = vi.mocked(ctx.port.uploadStartFrame).mock.calls.map((c) => c[2]);
    expect(await Promise.all(blobs.map((b) => b.text()))).toEqual(['picture s1 1', 'picture s1 2']);
    await waitFor(() => activity(ctx.chromeMock).includes('Auto-picked slide 1: shows the shoulder bag'), 'the activity line');
  });

  it('never overrides the owner\'s choice', async () => {
    const ctx = await setup({ slides: 4 });
    const p = await ctx.saved();
    const owner = { chosenPictureId: p.sceneStates.s1!.pictureIds[1], choiceSource: 'owner' as const };
    const legacy = { chosenPictureId: p.sceneStates.s2!.pictureIds[1] }; // chosen before Plan 3: the owner's
    p.sceneStates.s1 = { ...p.sceneStates.s1!, ...owner };
    p.sceneStates.s2 = { ...p.sceneStates.s2!, ...legacy };
    await ctx.store.saveProject(p);
    ctx.agent.replies = ['1 — first', '1 — first'];
    let release = () => undefined as void;
    ctx.agent.hold = new Promise<void>((r) => (release = r));
    await ctx.coordinator.startAutoPick(ctx.project.id);
    // Only s3 and s4 are asked about. While s3's question waits, the owner swaps s3 to picture 2.
    await waitFor(() => ctx.agent.questions.length === 1, 's3 asked');
    expect(ctx.agent.questions[0]!.names).toEqual(['vidflow-s03-a.png', 'vidflow-s03-b.png']);
    await ctx.coordinator.chooseScenePicture(ctx.project.id, 's3', p.sceneStates.s3!.pictureIds[1]!);
    ctx.agent.hold = null;
    release();
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    const after = (await ctx.saved()).sceneStates;
    expect(after.s1).toMatchObject(owner);
    expect(after.s1!.autoChecked).toBeUndefined();
    expect(after.s2!.chosenPictureId).toBe(legacy.chosenPictureId);
    expect(after.s2!.choiceSource).toBeUndefined();
    expect(after.s3).toMatchObject({ chosenPictureId: p.sceneStates.s3!.pictureIds[1], choiceSource: 'owner' }); // the live choice won
    expect(after.s4).toMatchObject({ chosenPictureId: p.sceneStates.s4!.pictureIds[0], choiceSource: 'auto', autoChecked: true });
    expect(ctx.agent.questions.map((q) => q.names[0])).toEqual(['vidflow-s03-a.png', 'vidflow-s04-a.png']);
  });

  it("an unclear answer keeps Flow's first", async () => {
    const ctx = await setup({ slides: 1 });
    ctx.agent.replies = ['Both are good'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    const s1 = (await ctx.saved()).sceneStates.s1!;
    expect(s1.chosenPictureId).toBeUndefined();
    expect(s1.choiceSource).toBeUndefined();
    expect(s1.autoChecked).toBe(true);
    expect(s1.autoReason).toBe('not auto-checked');
    await waitFor(() => activity(ctx.chromeMock).includes('Slide 1 not auto-checked'), 'the activity line');
  });

  it('90 s without an answer → not auto-checked, next slide', async () => {
    const ctx = await setup({ slides: 2 });
    ctx.agent.replies = [null, '1 — clearer'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    const after = (await ctx.saved()).sceneStates;
    expect(after.s1).toMatchObject({ autoChecked: true, autoReason: 'not auto-checked' });
    expect(after.s1!.chosenPictureId).toBeUndefined();
    expect(after.s2).toMatchObject({ choiceSource: 'auto', autoReason: 'clearer' });
    // The wait for one slide's answer is the run's whole reply limit, asked for in slices.
    const asked = vi.mocked(ctx.port.readAgentReply).mock.calls.map((c) => c[1]);
    expect(Math.max(...asked)).toBeLessThanOrEqual(FAST.agentSliceMs);
  });

  it('three unanswered in a row stops the pass', async () => {
    const ctx = await setup({ slides: 5 });
    ctx.agent.replies = ['Both', null, '1 or 2', 'nope'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    expect(ctx.agent.questions).toHaveLength(3);
    const after = (await ctx.saved()).sceneStates;
    for (const id of ['s1', 's2', 's3']) expect(after[id]).toMatchObject({ autoChecked: true, autoReason: 'not auto-checked' });
    for (const id of ['s4', 's5']) {
      expect(after[id]!.autoChecked).toBeUndefined();
      expect(after[id]!.chosenPictureId).toBeUndefined();
    }
    await waitFor(() => activity(ctx.chromeMock).includes(AUTO_PICK_GAVE_UP_MESSAGE), 'the plain message');
    expect(ctx.chromeMock.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ message: AUTO_PICK_GAVE_UP_MESSAGE }));
  });

  it('an answer in between starts the count again', async () => {
    const ctx = await setup({ slides: 5 });
    ctx.agent.replies = ['Both', 'Both', '2 — yes', 'Both', 'Both'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    expect(ctx.agent.questions).toHaveLength(5);
  });

  it('Agent mode is off afterwards, even when stopped', async () => {
    // A whole pass: the Agent is finished after every question.
    {
      const ctx = await setup({ slides: 2 });
      ctx.agent.replies = ['1 — a', '2 — b'];
      await ctx.coordinator.startAutoPick(ctx.project.id);
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
      expect(ctx.port.finishAgent.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(ctx.agent.open).toBe(false);
    }
    // Stopped while a question waits for its answer.
    {
      const ctx = await setup({ slides: 2 });
      let release = () => undefined as void;
      ctx.agent.hold = new Promise<void>((r) => (release = r));
      ctx.agent.replies = ['1 — a'];
      await ctx.coordinator.startAutoPick(ctx.project.id);
      await waitFor(() => ctx.agent.open, 'the question asked');
      await ctx.coordinator.stopRun();
      release();
      await waitFor(() => !ctx.agent.open, 'the Agent finished');
      await ctx.coordinator.settledForTests();
      expect(ctx.agent.questions).toHaveLength(1); // nothing more asked
      expect(ctx.coordinator.getRunState()!.status).toBe('idle');
      // Stopped: the slide's answer isn't written.
      expect((await ctx.saved()).sceneStates.s1!.autoChecked).toBeUndefined();
    }
    // Paused while a question waits: Agent off, and Resume asks again.
    {
      const ctx = await setup({ slides: 1 });
      let release = () => undefined as void;
      ctx.agent.hold = new Promise<void>((r) => (release = r));
      ctx.agent.replies = ['1 — a', '2 — b'];
      await ctx.coordinator.startAutoPick(ctx.project.id);
      await waitFor(() => ctx.agent.open, 'the question asked');
      await ctx.coordinator.pauseRun();
      release();
      ctx.agent.hold = null;
      await waitFor(() => !ctx.agent.open, 'the Agent finished');
      expect(ctx.coordinator.getRunState()!.status).toBe('paused');
      await ctx.coordinator.resumeRun();
      await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
      expect(ctx.agent.questions).toHaveLength(2);
      expect((await ctx.saved()).sceneStates.s1!.autoReason).toBe('b');
      expect(ctx.agent.open).toBe(false);
    }
  });

  it('comparison uploads never matched as pictures or clips', async () => {
    expect(isComparisonUpload('vidflow-s01-a.png')).toBe(true);
    expect(isComparisonUpload('Uploaded vidflow-s12-d.png')).toBe(true);
    expect(isComparisonUpload('A stickman in scene 1')).toBe(false);
    // A picture run's grid with a comparison upload in it: the slide's pictures are its own two tiles only.
    const ctx = await setup({ slides: 1, pictures: 0 });
    ctx.chromeMock.storage.local.data['vidflow.autoPick'] = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`png:${url}`]) })));
    await ctx.coordinator.startRun(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'submitted', 's1 submitted');
    const prompt = vi.mocked(ctx.port.prepare).mock.calls.at(-1)![2];
    // Its detail page would even show the slide's prompt: the caption alone keeps it out.
    vi.mocked(ctx.port.readDetail).mockImplementation(async () => ({ prompt, mediaId: (ctx.port.tilePoint.mock.calls.at(-1)?.[1] as string) ?? null }));
    await ctx.coordinator.handleTiles([card('k2', 0), card('up', 1, 'vidflow-s01-a.png'), card('k1', 2)]);
    await waitFor(() => ctx.coordinator.getRunState()?.sceneStates.s1?.status === 'done', 's1 done');
    expect(ctx.coordinator.getRunState()!.sceneStates.s1!.cardKeys).toEqual(['k1', 'k2']);
    expect(ctx.port.tilePoint.mock.calls.map((c) => c[1])).not.toContain('up');
  });

  it('0 credits: never presses Generate', async () => {
    const ctx = await setup({ slides: 3 });
    ctx.agent.replies = ['1 — a', 'Both', '2 — b'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    const points = vi.mocked(ctx.port.press).mock.calls.map(([, x, y]) => ({ x, y }));
    expect(points.filter((p) => p.x === AGENT_SEND.x && p.y === AGENT_SEND.y)).toHaveLength(3);
    expect(points.every((p) => (p.x === AGENT_SEND.x && p.y === AGENT_SEND.y) || (p.x === NEW_PROJECT.x && p.y === NEW_PROJECT.y))).toBe(true);
    expect(ctx.port.generateCost).not.toHaveBeenCalled();
    expect(ctx.port.prepare).not.toHaveBeenCalled();
    expect(ctx.port.prepareClip).not.toHaveBeenCalled();
    expect(ctx.port.confirmStarted).not.toHaveBeenCalled();
    expect(ctx.port.creditBalance).not.toHaveBeenCalled();
  });

  it('is its own run: in a fresh Flow project, behind the one-at-a-time lock, and on demand refuses with nothing to pick', async () => {
    const ctx = await setup({ slides: 1 });
    let release = () => undefined as void;
    ctx.agent.hold = new Promise<void>((r) => (release = r));
    ctx.agent.replies = ['1 — a'];
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.agent.open, 'the question asked');
    expect(ctx.port.findNewProject).toHaveBeenCalledTimes(1);
    await expect(ctx.coordinator.startRun(ctx.project.id)).rejects.toThrow(/auto-pick/i);
    await expect(ctx.coordinator.startClipRun(ctx.project.id, 10)).rejects.toThrow(/auto-pick/i);
    release();
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    // Everything is checked now: "Auto-pick now" says so.
    await expect(ctx.coordinator.startAutoPick(ctx.project.id)).rejects.toThrow(/No slide needs auto-picking/);
  });

  it('logs the live step "Auto-picking slide N of M"', async () => {
    const ctx = await setup({ slides: 2 });
    ctx.agent.replies = ['1 — a', '1 — b'];
    const steps: string[] = [];
    vi.mocked(ctx.chromeMock.storage.local.set).mockImplementation(async (items: Record<string, unknown>) => {
      const step = items['vidflow.step'] as { text?: string } | undefined;
      if (step?.text) steps.push(step.text);
      Object.assign(ctx.chromeMock.storage.local.data, items);
    });
    await ctx.coordinator.startAutoPick(ctx.project.id);
    await waitFor(() => ctx.coordinator.getRunState()?.status === 'finished', 'the pass finished');
    expect(steps).toContain('Auto-picking slide 1 of 2');
    expect(steps).toContain('Auto-picking slide 2 of 2');
  });
});

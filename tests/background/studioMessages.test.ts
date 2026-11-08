import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The coordinator is replaced: these tests are only about who may send studio requests to the background.
vi.mock('../../src/runs/coordinator', () => ({
  RunBlockedError: class extends Error {},
  chooseScenePicture: vi.fn(async () => undefined),
  discardFinishedRun: vi.fn(async () => undefined),
  getRunState: vi.fn(() => null),
  handleFlowEvent: vi.fn(async () => undefined),
  onRunState: vi.fn(),
  handleTiles: vi.fn(async () => undefined),
  isFlowTab: vi.fn(async () => false),
  pauseRun: vi.fn(async () => undefined),
  pillFor: vi.fn(async () => null),
  registerCoordinator: vi.fn(),
  resumeRun: vi.fn(async () => undefined),
  retryScene: vi.fn(async () => undefined),
  setFlowPort: vi.fn(),
  setStartChecks: vi.fn(),
  startHeroSheetRun: vi.fn(async () => undefined),
  startClipRun: vi.fn(async () => undefined),
  startAutoPick: vi.fn(async () => undefined),
  noteFlowTab: vi.fn(),
  startRun: vi.fn(async () => undefined),
  stopRun: vi.fn(async () => undefined),
  handleFlowNotice: vi.fn(async () => undefined),
}));
vi.mock('../../src/e2e/background', () => ({ registerE2e: vi.fn(() => true) }));
vi.mock('../../src/flow/port', () => ({ createFlowPort: vi.fn(() => ({})) }));
vi.mock('../../src/runs/checks', () => ({
  runChecks: vi.fn(async () => ({ flowOpen: false, rows: [] })),
  openFlow: vi.fn(async () => undefined),
  showMeInFlow: vi.fn(async () => ({ missing: ['ingredients button'] })),
  testOnePrompt: vi.fn(async () => ({ ok: true, message: 'Flow is ready.' })),
  startChecks: vi.fn(async () => null),
}));

type OnMessage = (message: unknown, sender: { id?: string; url?: string; tab?: { id?: number } }, sendResponse: (r: unknown) => void) => unknown;
let onMessage: OnMessage;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('defineBackground', (main: () => void) => main);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'vidflow',
      getURL: (p: string) => `chrome-extension://vidflow${p}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: (l: OnMessage) => (onMessage = l) },
    },
    action: { onClicked: { addListener: vi.fn() } },
  });
  const main = (await import('../../src/entrypoints/background')).default as unknown as () => void;
  main();
});
afterEach(() => vi.unstubAllGlobals());

const choose = { type: 'run/choose', projectId: 'p1', sceneId: 's1', pictureId: 'p1/b' };

describe('run/choose', () => {
  it('is refused from a sender that is not one of VidFlow\'s own pages', async () => {
    const { chooseScenePicture } = await import('../../src/runs/coordinator');
    const senders = [
      { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } }, // VidFlow's content script in Flow
      { id: 'other-extension', url: 'chrome-extension://other-extension/studio.html' },
      { id: 'vidflow', url: 'chrome-extension://vidflow/flow-helper.html' },
      { id: 'vidflow' },
    ];
    for (const sender of senders) {
      const sendResponse = vi.fn();
      expect(onMessage(choose, sender, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(chooseScenePicture).not.toHaveBeenCalled();
  });

  it('is carried out for the studio page', async () => {
    const { chooseScenePicture } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(choose, { id: 'vidflow', url: 'chrome-extension://vidflow/studio.html' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: null }));
    expect(chooseScenePicture).toHaveBeenCalledWith('p1', 's1', 'p1/b');
  });
});

describe('run/hero-sheet', () => {
  const sheet = { type: 'run/hero-sheet', projectId: 'p1' };

  it("is refused from VidFlow's content script in a Flow tab", async () => {
    const { startHeroSheetRun } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(sheet, { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } }, sendResponse)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).not.toHaveBeenCalled();
    expect(startHeroSheetRun).not.toHaveBeenCalled();
  });

  it('starts the model sheet for the studio page', async () => {
    const { startHeroSheetRun } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(sheet, { id: 'vidflow', url: 'chrome-extension://vidflow/studio.html' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: null }));
    expect(startHeroSheetRun).toHaveBeenCalledWith('p1');
  });
});

describe('run/make-clips', () => {
  const clips = { type: 'run/make-clips', projectId: 'p1', limit: 24 };

  it("is refused from VidFlow's content script in a Flow tab and from other extensions", async () => {
    const { startClipRun } = await import('../../src/runs/coordinator');
    for (const sender of [
      { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } },
      { id: 'other', url: 'chrome-extension://other/studio.html' },
    ]) {
      const sendResponse = vi.fn();
      expect(onMessage(clips, sender, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(startClipRun).not.toHaveBeenCalled();
  });

  it('starts the Motion run with its credit limit for the studio page', async () => {
    const { startClipRun } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(clips, { id: 'vidflow', url: 'chrome-extension://vidflow/studio.html' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: null }));
    expect(startClipRun).toHaveBeenCalledWith('p1', 24);
  });

  it("logs Flow's announcement and panels Flow left open in the run's activity", async () => {
    const coordinator = await import('../../src/runs/coordinator');
    const { createFlowPort } = await import('../../src/flow/port');
    const deps = vi.mocked(createFlowPort).mock.calls.at(-1)![0]!;
    deps.onAnnouncement!(7);
    deps.onLeftOpen!(7, 'account');
    deps.onLeftOpen!(7, 'agent');
    expect(vi.mocked(coordinator.noteFlowTab).mock.calls).toEqual([
      ["Closed Flow's announcement"],
      ["Flow's account panel didn't close"],
      ["Flow's Agent panel didn't close"],
    ]);
  });
});

describe('Checks tab messages', () => {
  const FLOW_SENDER = { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } };
  const PANEL = { id: 'vidflow', url: 'chrome-extension://vidflow/sidepanel.html' };
  const cases = [
    { message: { type: 'run/checks', projectId: 'p1' }, fn: 'runChecks', args: ['p1'], reply: { ok: true, flowOpen: false, rows: [] } },
    { message: { type: 'run/open-flow' }, fn: 'openFlow', args: [], reply: { ok: true } },
    { message: { type: 'run/show-me' }, fn: 'showMeInFlow', args: [], reply: { ok: true, missing: ['ingredients button'] } },
    { message: { type: 'run/test-prompt', projectId: 'p1' }, fn: 'testOnePrompt', args: ['p1'], reply: { ok: true, message: 'Flow is ready.' } },
  ] as const;

  it("are refused from VidFlow's content script in a Flow tab and from other extensions", async () => {
    const checks = (await import('../../src/runs/checks')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const c of cases) {
      for (const sender of [FLOW_SENDER, { id: 'other', url: 'chrome-extension://other/sidepanel.html' }]) {
        const sendResponse = vi.fn();
        expect(onMessage(c.message, sender, sendResponse)).toBeUndefined();
        expect(sendResponse).not.toHaveBeenCalled();
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    for (const c of cases) expect(checks[c.fn]).not.toHaveBeenCalled();
  });

  it("are answered for VidFlow's side panel", async () => {
    const checks = (await import('../../src/runs/checks')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const c of cases) {
      const sendResponse = vi.fn();
      expect(onMessage(c.message, PANEL, sendResponse)).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(c.reply));
      expect(checks[c.fn]).toHaveBeenCalledWith(...c.args);
    }
  });

  it('a refusal comes back as a plain message', async () => {
    const checks = await import('../../src/runs/checks');
    vi.mocked(checks.showMeInFlow).mockRejectedValueOnce(new Error('VidFlow is making pictures right now.'));
    const sendResponse = vi.fn();
    onMessage({ type: 'run/show-me' }, PANEL, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, message: 'VidFlow is making pictures right now.' }));
  });

  it('Start runs the checks first: the background sets the gate', async () => {
    const coordinator = await import('../../src/runs/coordinator');
    const checks = await import('../../src/runs/checks');
    expect(coordinator.setStartChecks).toHaveBeenCalledWith(checks.startChecks);
  });
});

describe('the e2e build', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('runs the Checks before every Start too, so the live check exercises them', async () => {
    vi.resetModules();
    vi.stubEnv('MODE', 'e2e');
    // Mocked modules outlive resetModules: forget what the normal build's start (beforeEach) did.
    const coordinator = await import('../../src/runs/coordinator');
    const checks = await import('../../src/runs/checks');
    const e2e = await import('../../src/e2e/background');
    vi.mocked(coordinator.setStartChecks).mockClear();
    vi.mocked(e2e.registerE2e).mockClear();
    const main = (await import('../../src/entrypoints/background')).default as unknown as () => void;
    main();
    expect(e2e.registerE2e).toHaveBeenCalled();
    expect(coordinator.setStartChecks).toHaveBeenCalledWith(checks.startChecks);
  });
});

describe("Flow's usage notice while VidFlow waits", () => {
  it("goes to the coordinator only from VidFlow's own Flow tab", async () => {
    const coordinator = await import('../../src/runs/coordinator');
    vi.mocked(coordinator.isFlowTab).mockResolvedValueOnce(false);
    onMessage({ type: 'flow/notice' }, { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } }, vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(coordinator.handleFlowNotice).not.toHaveBeenCalled();
    vi.mocked(coordinator.isFlowTab).mockResolvedValueOnce(true);
    onMessage({ type: 'flow/notice' }, { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 7 } }, vi.fn());
    await vi.waitFor(() => expect(coordinator.handleFlowNotice).toHaveBeenCalledWith(7));
  });
});

describe('run/auto-pick', () => {
  const autoPick = { type: 'run/auto-pick', projectId: 'p1' };

  it("is refused from VidFlow's content script in a Flow tab and from other extensions", async () => {
    const { startAutoPick } = await import('../../src/runs/coordinator');
    for (const sender of [
      { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } },
      { id: 'other', url: 'chrome-extension://other/studio.html' },
    ]) {
      const sendResponse = vi.fn();
      expect(onMessage(autoPick, sender, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(startAutoPick).not.toHaveBeenCalled();
  });

  it('starts Auto-pick for the studio page', async () => {
    const { startAutoPick } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(autoPick, { id: 'vidflow', url: 'chrome-extension://vidflow/studio.html' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: null }));
    expect(startAutoPick).toHaveBeenCalledWith('p1');
  });
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowChecksResponse } from '../../src/flow/messages';
import type { Project } from '../../src/store/projects';
import { memoryMediaStore } from '../../src/store/media';

const PROJECT_URL = 'https://flow.google.com/u/0/project/3f1c2a9e-1111-4222-8333-944455556666';
const OWNER = 'unscripted4ce@gmail.com';

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Demo',
  createdAt: 0,
  updatedAt: 0,
  scenes: [],
  sceneStates: {},
  style: 'stickman',
  character: null,
  aspect: '9:16',
  outputsPerPrompt: 2,
  ...over,
} as Project);

const withReference = (p: Project = project()) => ({ ...p, character: { description: 'a stickman', referenceMediaId: 'p1/hero-reference' } });

/** What the Flow helper reads on a healthy Flow project page set up for the project above. */
const good = (over: Partial<FlowChecksResponse> = {}): FlowChecksResponse => ({
  account: OWNER,
  page: true,
  promptBox: true,
  generate: true,
  agentOff: true,
  model: 'Nano Banana 2.1',
  aspect: '9:16',
  outputs: 2,
  credits: null,
  noticeDialog: false,
  billingDialog: false,
  ...over,
});

async function load(opts: { tab?: { tabId: number; url: string } | null; read?: FlowChecksResponse | undefined; p?: Project; live?: boolean } = {}) {
  vi.resetModules();
  const checks = await import('../../src/runs/checks');
  const ask = vi.fn(async (_tabId: number, _m: { type: string }): Promise<unknown> => ('read' in opts ? opts.read : good()));
  const deps = {
    flowTab: vi.fn(async () => (opts.tab === undefined ? { tabId: 7, url: PROJECT_URL } : opts.tab)),
    openFlowTab: vi.fn(async () => 7),
    focusTab: vi.fn(async () => undefined),
    ask,
    project: vi.fn(async () => opts.p ?? project()),
    hasMedia: vi.fn(async () => true),
    expectedAccount: vi.fn(async () => OWNER),
    acceptNotices: vi.fn(async () => true),
    runLive: vi.fn(() => opts.live ?? false),
    openProject: vi.fn(async () => undefined),
  };
  checks.setChecksDepsForTests(deps);
  return { checks, deps };
}

describe('runChecks', () => {
  it('no Flow tab: every row is "Not checked yet" and flowOpen is false', async () => {
    const { checks, deps } = await load({ tab: null, p: withReference() });
    const { flowOpen, rows } = await checks.runChecks('p1');
    expect(flowOpen).toBe(false);
    expect(rows.map((r) => r.id)).toEqual(['account', 'page', 'promptBox', 'generate', 'agentOff', 'settings', 'hero', 'credits']);
    for (const r of rows) {
      expect(r.ok).toBeNull();
      expect(r.detail).toBe('Not checked yet');
    }
    expect(deps.ask).not.toHaveBeenCalled(); // only VidFlow's own Flow tab is ever read
    expect(checks.healthLine(rows, flowOpen)).toEqual(['Flow not open']);
  });

  it('all good gives eight ticks', async () => {
    const { checks, deps } = await load({ p: withReference(), read: good({ credits: 1250 }) });
    const { flowOpen, rows } = await checks.runChecks('p1');
    expect(flowOpen).toBe(true);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.ok === true)).toBe(true);
    expect(rows.find((r) => r.id === 'credits')!.detail).toMatch(/1,250 credits · 0 needed/);
    expect(deps.ask).toHaveBeenCalledWith(7, { type: 'flow/checks' });
    expect(checks.healthLine(rows, flowOpen)).toEqual(['✓ Signed in', '✓ Flow ready', '✓ Hero attached']);
  });

  it('credits not shown on the page: the row reads "0 needed" for pictures', async () => {
    const { checks } = await load();
    const { rows } = await checks.runChecks('p1');
    expect(rows.find((r) => r.id === 'credits')).toMatchObject({ ok: true, detail: '0 needed for pictures' });
  });

  it('wrong account / Agent on / settings differ each give a plain fix', async () => {
    let { checks } = await load({ read: good({ account: 'someone@gmail.com' }) });
    let { rows } = await checks.runChecks('p1');
    const account = rows.find((r) => r.id === 'account')!;
    expect(account.ok).toBe(false);
    expect(account.fix).toBe(
      `Flow is signed in to someone@gmail.com, but VidFlow is set to use ${OWNER}. Switch Flow to ${OWNER}.`,
    );
    expect(checks.healthLine(rows, true)[0]).toBe('Wrong Google account');

    ({ checks } = await load({ read: good({ agentOff: false }) }));
    ({ rows } = await checks.runChecks('p1'));
    const agent = rows.find((r) => r.id === 'agentOff')!;
    expect(agent).toMatchObject({ ok: false, detail: 'Agent mode is on' });
    expect(agent.fix).toMatch(/Turn off Agent mode in Flow/);
    expect(checks.healthLine(rows, true)).toContain('Agent mode on');

    ({ checks } = await load({ read: good({ aspect: '16:9', outputs: 1 }) }));
    ({ rows } = await checks.runChecks('p1'));
    const settings = rows.find((r) => r.id === 'settings')!;
    expect(settings.ok).toBe(false);
    expect(settings.detail).toBe('Flow: Nano Banana 2.1 · 16:9 · x1 · this video: Image · 9:16 · x2');
    expect(settings.fix).toBe('VidFlow sets Flow to Image · 9:16 · 2 pictures when it starts. Press Test one prompt to set them now.');
  });

  it('signed out, a billing message and an unanswered page each say what to do', async () => {
    let { checks } = await load({ read: good({ account: null }) });
    let { rows } = await checks.runChecks('p1');
    expect(rows.find((r) => r.id === 'account')!.fix).toBe(`Sign in to Flow as ${OWNER} in VidFlow's Flow window.`);

    ({ checks } = await load({ read: good({ billingDialog: true }) }));
    ({ rows } = await checks.runChecks('p1'));
    expect(rows.find((r) => r.id === 'page')!.fix).toMatch(/never accepts billing/);

    ({ checks } = await load({ read: undefined }));
    ({ rows } = await checks.runChecks('p1'));
    expect(rows.find((r) => r.id === 'page')).toMatchObject({ ok: false, fix: "Wait for VidFlow's Flow window to finish loading, then try again." });
  });

  it("on Flow's home page the prompt-bar rows wait for the run's own project", async () => {
    const { checks } = await load({
      tab: { tabId: 7, url: 'https://flow.google.com/' },
      read: good({ promptBox: false, generate: false, model: null, aspect: null, outputs: null }),
    });
    const { rows } = await checks.runChecks('p1');
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.page).toMatchObject({ ok: true, detail: 'Flow home · VidFlow opens a new project when it starts' });
    for (const id of ['promptBox', 'generate', 'agentOff', 'settings']) expect(by[id]).toMatchObject({ ok: null, detail: 'Checked when a Flow project is open' });
  });

  it('hero row only when the video has a reference', async () => {
    let { checks, deps } = await load();
    let { rows } = await checks.runChecks('p1');
    expect(rows.map((r) => r.id)).not.toContain('hero');
    expect(rows).toHaveLength(7);
    expect(checks.healthLine(rows, true)).toEqual(['✓ Signed in', '✓ Flow ready']);

    ({ checks, deps } = await load({ p: withReference() }));
    deps.hasMedia.mockResolvedValue(false);
    ({ rows } = await checks.runChecks('p1'));
    const hero = rows.find((r) => r.id === 'hero')!;
    expect(hero.ok).toBe(false);
    expect(hero.fix).toMatch(/can't find the hero's reference picture/);
    expect(checks.healthLine(rows, true)).toContain('Hero picture missing');
  });
});

describe('Show me in Flow / Test one prompt / Open Flow', () => {
  it("show me in Flow names what it couldn't find", async () => {
    const { checks, deps } = await load();
    deps.ask.mockResolvedValue({ missing: ['ingredients button'] });
    await expect(checks.showMeInFlow()).resolves.toEqual({ missing: ['ingredients button'] });
    expect(deps.ask).toHaveBeenCalledWith(7, { type: 'flow/show-me' });
    expect(deps.focusTab).toHaveBeenCalledWith(7);
  });

  it('show me in Flow is refused while a run is live, and without a Flow window', async () => {
    let { checks, deps } = await load({ live: true });
    await expect(checks.showMeInFlow()).rejects.toThrow(/making pictures right now/);
    expect(deps.ask).not.toHaveBeenCalled();
    ({ checks, deps } = await load({ tab: null }));
    await expect(checks.showMeInFlow()).rejects.toThrow(/Press Open Flow/);
  });

  it('test one prompt is refused while a run is live', async () => {
    const { checks, deps } = await load({ live: true });
    const result = await checks.testOnePrompt('p1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/making pictures right now/);
    expect(deps.openProject).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("test one prompt puts the tab on a Flow project, then asks the helper with the video's settings", async () => {
    const { checks, deps } = await load({ p: project({ aspect: '16:9', outputsPerPrompt: 4 }) });
    deps.ask.mockResolvedValue({ ok: true, message: 'Flow is ready.' });
    await expect(checks.testOnePrompt('p1')).resolves.toEqual({ ok: true, message: 'Flow is ready.' });
    expect(deps.openProject).toHaveBeenCalledWith(7);
    expect(deps.ask).toHaveBeenCalledWith(7, { type: 'flow/test-prompt', aspect: '16:9', outputs: 4 });
    expect(deps.openProject.mock.invocationCallOrder[0]!).toBeLessThan(deps.ask.mock.invocationCallOrder[0]!);
  });

  it('open Flow opens (or finds) VidFlow’s Flow window and brings it forward', async () => {
    const { checks, deps } = await load({ tab: null });
    await checks.openFlow();
    expect(deps.openFlowTab).toHaveBeenCalled();
    expect(deps.focusTab).toHaveBeenCalledWith(7);
  });
});

// ---- Start runs the checks first --------------------------------------------

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
  vi.stubGlobal('chrome', {
    storage: { local: area(), session: area(), onChanged: listener() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), onAlarm: listener() },
    power: { requestKeepAwake: vi.fn(), releaseKeepAwake: vi.fn() },
    notifications: { create: vi.fn(async () => '') },
    windows: { create: vi.fn(async () => ({ id: 3, tabs: [{ id: 7 }] })), update: vi.fn(async () => undefined), onRemoved: listener() },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      update: vi.fn(async (_id: number, props: { url?: string }) => void (props.url !== undefined && (tab.url = props.url))),
      setZoomSettings: vi.fn(async () => undefined),
      setZoom: vi.fn(async () => undefined),
      getZoom: vi.fn(async () => 1),
    },
    runtime: { onStartup: listener(), getURL: (p: string) => `chrome-extension://test/${p}` },
    debugger: { attach: vi.fn(async () => undefined), detach: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) },
  });
}

describe('Start', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  async function startSetup(read: FlowChecksResponse) {
    vi.resetModules();
    mockChrome();
    const store = await import('../../src/store/projects');
    store.setMediaStore(memoryMediaStore());
    const coordinator = await import('../../src/runs/coordinator');
    const checks = await import('../../src/runs/checks');
    coordinator.registerCoordinator();
    const port = {
      findNewProject: vi.fn(async () => ({ x: 5, y: 5 })),
      prepare: vi.fn(async () => ({ x: 1, y: 1 })),
      press: vi.fn(async () => undefined),
      confirmStarted: vi.fn(async () => true as const),
      tiles: vi.fn(async () => []),
      tilePoint: vi.fn(async () => ({ x: 1, y: 1 })),
      readDetail: vi.fn(async () => ({ prompt: null, mediaId: null })),
      uploadReference: vi.fn(async () => null),
      acceptNotice: vi.fn(async () => true),
    };
    coordinator.setFlowPort(port);
    const p = await store.createProject('Demo');
    p.aspect = '9:16';
    p.outputsPerPrompt = 2;
    p.scenes = [
      { id: 's1', slide: 1, start: null, end: null, sentence: 'Hi.', concept: 'c', textOverlay: '', imagePrompt: 'A stickman waves', motionPrompt: 'Waves', motionPromptIsDefault: false },
    ];
    await store.saveProject(p);
    const ask = vi.fn(async () => read);
    let open = false;
    const openFlowTab = vi.fn(async () => {
      open = true;
      return 7;
    });
    checks.setChecksDepsForTests({
      flowTab: async () => (open ? { tabId: 7, url: 'https://flow.google.com/' } : null),
      openFlowTab,
      ask,
      expectedAccount: async () => OWNER,
      acceptNotices: async () => true,
    });
    coordinator.setStartChecks(checks.startChecks);
    return { coordinator, port, p, ask, openFlowTab };
  }

  it('start runs the checks first and stops on a failing one', async () => {
    const { coordinator, port, p, ask, openFlowTab } = await startSetup(good({ agentOff: false, promptBox: false, generate: false, model: null, aspect: null, outputs: null }));
    const err = await coordinator.startRun(p.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(coordinator.RunBlockedError);
    expect((err as Error).message).toMatch(/Agent mode/);
    expect(openFlowTab).toHaveBeenCalled(); // Flow wasn't open: opened, then checked
    expect(ask).toHaveBeenCalledWith(7, { type: 'flow/checks' });
    expect(coordinator.getRunState()).toBeNull(); // the run never started
    expect(port.findNewProject).not.toHaveBeenCalled();
    expect(port.prepare).not.toHaveBeenCalled();
  });

  it('start goes ahead when the checks pass (settings that differ are set by the run itself)', async () => {
    const { coordinator, p } = await startSetup(good({ promptBox: false, generate: false, model: 'Nano Banana 2.1', aspect: '16:9', outputs: 1 }));
    await coordinator.startRun(p.id);
    expect(coordinator.getRunState()?.status).toBe('running');
    await coordinator.stopRun();
  });

  it('a model sheet run only stops on the account, page, prompt bar and Agent mode', async () => {
    const { coordinator, p, ask } = await startSetup(good({ account: 'someone@gmail.com' }));
    const store = await import('../../src/store/projects');
    const saved = (await store.getProject(p.id))!;
    saved.character = { description: 'a stickman', referenceMediaId: 'missing' }; // a missing reference doesn't stop a sheet
    await store.saveProject(saved);
    await expect(coordinator.startHeroSheetRun(p.id)).rejects.toThrow(/Switch Flow to/);
    expect(ask).toHaveBeenCalled();
    ask.mockResolvedValue(good());
    await coordinator.startHeroSheetRun(p.id);
    expect(coordinator.getRunState()?.status).toBe('running');
    await coordinator.stopRun();
  });

  it("test one prompt's Flow project: New project is pressed on Flow's home page, never while a run is live", async () => {
    const { coordinator, port, p } = await startSetup(good());
    const tab = await chrome.tabs.get(7);
    expect(tab.url).toBe('https://flow.google.com/');
    port.press.mockImplementation(async () => {
      (chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 7, windowId: 3, url: PROJECT_URL, active: true });
    });
    await coordinator.openTestFlowProject(7);
    expect(port.findNewProject).toHaveBeenCalledWith(7, 'Start');
    expect(port.press).toHaveBeenCalledWith(7, 5, 5);
    expect(chrome.debugger.detach).toHaveBeenCalled(); // Chrome's debugging bar goes at once
    expect(coordinator.getRunState()).toBeNull(); // the run's state is never touched

    await coordinator.startRun(p.id);
    port.findNewProject.mockClear();
    await expect(coordinator.openTestFlowProject(7)).rejects.toThrow(/making pictures right now/);
    await coordinator.stopRun();
  });
});

/// <reference types="chrome" />
import { policyDialogMessage, type ClipFile, type FlowResultCard, type StartVerb } from '../flow/driver';
import { matchResults, unverifiedKeys, UNCONFIRMED_MESSAGE, verifyMatch, type Submission } from '../flow/match';
import {
  CLIP_ASPECT_MESSAGE,
  FlowBlockedError,
  REFERENCE_ATTACH_MESSAGE,
  TEST_WHILE_STARTING_MESSAGE,
  testPromptRefusal as refusalForStatus,
  type Point,
  type SubmitOptions,
} from '../flow/messages';
import { isFlowUrl } from '../flow/hosts';
import { flowProjectAction, isFlowHome, projectUrlOf } from '../flow/project';
import { liveView } from '../flow/live';
import type { LiveView } from '../flow/messages';
import { detachFlowDebugger } from '../flow/press';
import type { FlowMotionPort } from '../flow/port';
import { scenesToClip, startFrameName } from '../motion/clips';
import { createFlowDownloadGuard } from '../motion/flowDownloads';
import { mp4Duration } from '../motion/mp4';
import { CLIP_COST, useRange } from '../motion/timing';
import { buildImagePrompt, buildModelSheetPrompt } from '../prompts/build';
import { customStyle, STYLE_PRESETS } from '../prompts/styles';
import { logActivity, sceneNumber, setStep, STEP_KEY, type Step, type StepTarget } from './activity';
import { getMediaStore, getProject, updateProject, type Project, type SceneState } from '../store/projects';
import { getAcceptNotices, getKeepAwake, KEEP_AWAKE_KEY } from '../settings';
import { autoSaveScene, forgetDownloads } from '../files/downloads';
import {
  BALANCE_NOTE,
  CREDIT_LIMIT_NOTE,
  HERO_SHEET_ID,
  initClipRun,
  initHeroSheetRun,
  initRun,
  isClipRun,
  isHeroSheetRun,
  isLive,
  isSceneRun,
  nextSceneToSubmit,
  normaliseEvent,
  NOT_THIS_SCENES_PICTURE,
  reduceRun,
  runSummary,
  SKIPPED_MESSAGE,
  USER_PAUSE_REASON,
  type RunEvent,
  type RunState,
} from './run';

/**
 * How the coordinator talks to Flow; src/flow/port.ts implements it. prepare/findNewProject throw FlowBlockedError when
 * the run must pause. Pressing is separate so the coordinator re-checks the run right before every press.
 */
export interface FlowPort {
  /** Types the prompt (and sets mode/aspect/outputs); answers with where Generate is. Does not press. */
  prepare(tabId: number, sceneId: string, prompt: string, options?: SubmitOptions): Promise<Point>;
  /** On Flow's home page: checks the account, answers with where "New project" is. */
  findNewProject(tabId: number, verb: StartVerb): Promise<Point>;
  /** Trusted press at a point in the tab. */
  press(tabId: number, x: number, y: number): Promise<void>;
  /**
   * After pressing Generate: true once Flow cleared the box or showed a new in-progress tile (~8 s); 'notice' when it
   * didn't start and Flow's usage-policy / rights notice is showing instead; 'billing' when a billing or upgrade
   * dialog is (never accepted).
   */
  confirmStarted(tabId: number): Promise<boolean | 'notice' | 'billing'>;
  /** The result tiles in the Flow tab's DOM right now. */
  tiles(tabId: number): Promise<FlowResultCard[]>;
  /** Where the finished tile with this media id is (scrolled into view), to open its detail view. */
  tilePoint(tabId: number, key: string): Promise<Point>;
  /** On a picture's detail page: the full prompt it shows, and the picture's media id when the page has one. */
  readDetail(tabId: number): Promise<{ prompt: string | null; mediaId: string | null }>;
  /**
   * Uploads the hero reference into the Flow project as an asset named `name` (skipped when it's already there);
   * answers with the media id of the grid tile it makes, or null when that didn't show.
   */
  uploadReference(tabId: number, name: string, image: Blob): Promise<string | null>;
  /**
   * Ticks and accepts Flow's open usage-policy / rights notice in VidFlow's own Flow tab (never a billing dialog).
   * False when it couldn't; null when the page gave no answer (e.g. it reloaded after accepting); 'gone' when no notice
   * is showing any more (accepted or closed meanwhile).
   */
  acceptNotice(tabId: number): Promise<boolean | null | 'gone'>;
}

/**
 * The port the coordinator holds: FlowPort, plus Plan 3's Flow work (clips, Agent questions; src/flow/port.ts makes
 * both). The motion part is optional so a picture-only port (tests, older fakes) still drives picture runs; a clip run
 * pauses without it.
 */
export type RunPort = FlowPort & Partial<FlowMotionPort>;

// The VidFlow logo (public/icon/128.png); chrome requires an iconUrl on basic notifications.
const notificationIcon = () => chrome.runtime.getURL('icon/128.png');
const RUN_KEY = 'vidflow.run';

/** The last underlying error behind a "couldn't send" failure, for diagnosis (shown by the e2e build's status). */
let lastSendError: { sceneId: string; error: string; at: number } | null = null;
export const getLastSendError = async () =>
  lastSendError ?? ((await chrome.storage.local.get('vidflow.lastSendError'))['vidflow.lastSendError'] as typeof lastSendError) ?? null;
const WINDOW_KEY = 'vidflow.flowWindow';
const SESSION_MARKER = 'vidflow.sessionAlive';
const RESUME_ALARM = 'vidflow-resume';
const DEADLINE_PREFIX = 'vidflow-deadline:';
const DEADLINE_MINUTES = 10;
const FLOW_URL = 'https://flow.google.com/';
const MAX_IN_FLIGHT = 3;

/** Waits and pacing. Tests shorten them with setTimingsForTests; the extension always uses these defaults. */
const timings = {
  paceMinMs: 4000,
  paceMaxMs: 7000,
  urlWaitMs: 30_000,
  urlPollMs: 500,
  backWaitMs: 5_000,
  /** How long a scene whose start VidFlow didn't see may wait on a still-generating tile before it fails. */
  unconfirmedWaitMs: DEADLINE_MINUTES * 60_000,
  /** A clip run asks the Flow tab for its video tiles this often (the page itself reports picture tiles only). */
  clipPollMs: 5_000,
};

/** Tests only: shorter waits, so a test doesn't sit out the real pacing between scenes. */
export function setTimingsForTests(over: Partial<typeof timings>): void {
  Object.assign(timings, over);
}
// A blocked run is always left paused, so owner-facing messages from the pump name Resume.
const PUMP_VERB: StartVerb = 'Resume';
export const NOT_STARTED_MESSAGE = "VidFlow pressed Generate but Flow didn't start. Check the Flow window, then press Resume.";
/** Tile reports this soon after returning from a detail page don't count towards giving up on a scene. */
const SETTLE_MS = 3_000;
/** Consecutive qualifying reports (or unreadable detail reads) before VidFlow gives up on a scene. */
const GIVE_UP_AFTER = 2;
const SAVE_FAILED_MESSAGE = "VidFlow couldn't save this scene's pictures. Press Try again.";
const UNTRUSTED_PICTURE_MESSAGE = "Flow gave VidFlow a picture from an address it doesn't trust, so it wasn't saved. Press Try again.";
export const WINDOW_CLOSED_MESSAGE = "VidFlow's Flow window was closed. Press Resume to open it again.";
const NO_PROJECT_MESSAGE = "VidFlow pressed New project but Flow didn't open one. Check the Flow window, then press Resume.";
export const REFERENCE_MISSING_MESSAGE =
  "VidFlow can't find the hero's reference picture. Add it again in the Script step, or remove it, then press Resume.";

export const BUSY_MESSAGE = 'Another project is making pictures right now. Pause it or wait for it to finish, then try again.';
/** A scene run can't start while the hero's model sheet is being made (one run at a time). */
export const HERO_SHEET_BUSY_MESSAGE = 'VidFlow is making the model sheet right now. Wait for it to finish, then try again.';
/** …and while it is paused: the Script step's hero section has its Resume and Stop. */
export const HERO_SHEET_PAUSED_MESSAGE = 'The model sheet is paused. Resume or stop it in the Script step, then try again.';
/** The model sheet can't start while this same video's scenes are being made. */
export const HERO_SHEET_SCENES_BUSY = 'This video is making pictures right now. Wait for it to finish, then make the model sheet.';
/** The model sheet draws the hero as described: without a description there is nothing to draw. */
export const HERO_SHEET_NEEDS_HERO = 'Describe the hero first, then make the model sheet.';

/** A run can't start because another project's run is going or waiting; the message says which and what to do. */
export class RunBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunBlockedError';
  }
}

type RunStateListener = (state: RunState) => void;
const listeners = new Set<RunStateListener>();

/** The background forwards every state change to the studio through this. Returns an unsubscribe. */
export function onRunState(listener: RunStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface FlowWindow {
  windowId: number;
  tabId: number;
}

let port: RunPort | null = null;
let state: RunState | null = null;
let pumping = false;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Everything that drives the Flow tab (submitting, opening a picture's detail) takes turns through this. */
let tabQueue: Promise<unknown> = Promise.resolve();
/** The latest tiles VidFlow's Flow tab reported; matched to scenes by processTiles. */
let latestReport: { id: number; at: number; cards: FlowResultCard[] } = { id: 0, at: 0, cards: [] };
/** When the Flow tab last came back from a detail page; reports soon after may show a half-drawn grid. */
let lastDetailReturn = 0;
/** Per scene: how many qualifying tile reports in a row showed no consistent assignment, and the last one counted. */
const unconfirmedStreak = new Map<string, { count: number; reportId: number }>();
/** Per card: detail reads that didn't show this card plainly, counted once per tile report (attempt). */
const unreadCount = new Map<string, { count: number; attempt: number }>();
let unconfirmedAttempt = 0;
/** True while the Flow tab is away on a picture's detail page; tile reports from there are ignored. */
let inDetail = false;
let matching = false;
let matchAgain = false;
/** The scene submitScene is sending now (typing its prompt or pressing Generate), for Skip. */
let submitting: string | null = null;

export { SKIPPED_MESSAGE };

/** Run `fn` after everything queued before it, so state changes and saves never interleave. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.catch(() => undefined);
  return result;
}

function withTab<T>(fn: () => Promise<T>): Promise<T> {
  const result = tabQueue.then(fn);
  tabQueue = result.catch(() => undefined);
  return result;
}

export function setFlowPort(p: RunPort): void {
  port = p;
  void pump();
}

/** The port with its clip methods, or null when it has none (a clip run then pauses). */
function motionPort(): (FlowPort & FlowMotionPort) | null {
  const p = port;
  if (!p) return null;
  const needed: Array<keyof FlowMotionPort> = ['prepareClip', 'uploadStartFrame', 'generateCost', 'creditBalance', 'videoTiles', 'readVideoDetail', 'clipFile'];
  return needed.every((k) => typeof p[k] === 'function') ? (p as FlowPort & FlowMotionPort) : null;
}

export function getRunState(): RunState | null {
  return state;
}

/**
 * Tests only: resolves once nothing is queued, matching or pumping (checked over a few turns of the event loop), so a
 * test can assert that something did NOT happen without a fixed sleep. Gives up after ~2 s (a pump that keeps looking).
 */
export async function settledForTests(): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 400 && quiet < 3; i++) {
    const q = queue;
    const t = tabQueue;
    await q;
    await t;
    await new Promise((r) => setTimeout(r, 5));
    quiet = q === queue && t === tabQueue && !matching && !pumping ? quiet + 1 : 0;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const paceMs = () => timings.paceMinMs + Math.random() * (timings.paceMaxMs - timings.paceMinMs);

function notify(message: string): void {
  void chrome.notifications.create({ type: 'basic', iconUrl: notificationIcon(), title: 'VidFlow', message });
}

/**
 * Records what the run is doing for the Flow panel: the current step (only while running) and a line in the log.
 * Fire and forget: a storage failure is logged and never reaches the run, and nothing here waits on the queue.
 */
function note(project: Project, sceneId: string | null, text: string, target: StepTarget = null, key?: string): void {
  const at = Date.now();
  const writes = [logActivity({ at, projectId: project.id, sceneId, text })];
  if (target !== null && stillRunning(project.id)) writes.push(setStep({ projectId: project.id, sceneId, text, target, ...(key ? { key } : {}), at }));
  for (const w of writes) w.catch((err) => console.warn('[VidFlow] activity write failed', err));
}

const pictures = (n: number) => `${n} picture${n === 1 ? '' : 's'}`;

/** Log lines for what changed between two run states (scene results and the run's own status). */
function noteChanges(prev: RunState | null, next: RunState, project: Project): void {
  const clips = isClipRun(next);
  for (const [sceneId, now] of Object.entries(next.sceneStates)) {
    const before = prev?.sceneStates[sceneId]?.status;
    if (before === now.status) continue;
    if (now.status === 'submitted') note(project, sceneId, 'Sent to Flow');
    else if (now.status === 'done') note(project, sceneId, clips ? '✓ Saved clip' : `✓ Saved ${pictures(now.pictureIds.length)}`);
    else if (now.status === 'refused' || now.status === 'failed') note(project, sceneId, now.message ?? 'Needs a look');
  }
  if (prev?.status === next.status) return;
  if (next.status === 'paused') {
    note(project, null, next.pauseReason && next.pauseReason !== USER_PAUSE_REASON ? `Paused: ${next.pauseReason}` : 'Paused by you');
  } else if (next.status === 'running' && prev?.status === 'paused') note(project, null, 'Resumed');
  else if (next.status === 'finished') {
    const { done } = runSummary(next);
    if (isHeroSheetRun(next)) note(project, null, done > 0 ? 'Finished: the model sheet is ready' : 'Finished: the model sheet needs a look');
    else if (clips) note(project, null, `Finished: clips made for ${done} of ${Object.keys(next.sceneStates).length} slides (${next.spent ?? 0} credits used)`);
    else note(project, null, `Finished: pictures ready for ${done} of ${Object.keys(next.sceneStates).length} scenes`);
  }
}

/** What Flow was (or will be) asked for: a sheet run keeps the outputs and shape it started with. */
const outputsOf = (run: RunState | null, project: Project) => (isClipRun(run) ? 1 : (run?.sheet?.outputs ?? project.outputsPerPrompt));
const aspectOf = (run: RunState | null, project: Project) => run?.sheet?.aspect ?? project.aspect;

/** Why a live clip run blocks another start: it is making clips, or it is paused. */
const clipsBlock = (run: RunState) => (run.status === 'paused' ? CLIPS_PAUSED_MESSAGE : CLIPS_BUSY_MESSAGE);

/** Why a live model sheet run blocks another start: it is being made, or it is paused. */
const sheetBlock = (run: RunState) => (run.status === 'paused' ? HERO_SHEET_PAUSED_MESSAGE : HERO_SHEET_BUSY_MESSAGE);

function projectStyle(project: Project) {
  return project.style === 'custom' ? customStyle(project.customStyle ?? '') : STYLE_PRESETS[project.style];
}

// ---- Flow window ---------------------------------------------------------

async function savedFlowWindow(): Promise<FlowWindow | undefined> {
  return (await chrome.storage.local.get(WINDOW_KEY))[WINDOW_KEY] as FlowWindow | undefined;
}

async function forgetFlowWindow(): Promise<void> {
  await chrome.storage.local.remove(WINDOW_KEY);
}

/** True only for the tab VidFlow opened as its own Flow tab. */
export async function isFlowTab(tabId: number | undefined): Promise<boolean> {
  return tabId !== undefined && (await savedFlowWindow())?.tabId === tabId;
}

let openingFlowTab: Promise<number> | null = null;

/**
 * Returns the tab id of VidFlow's own Flow tab, opening a dedicated window if needed. One at a time: the pump and a
 * Resume's tile pull can ask together, and must not open two windows.
 */
function ensureFlowTab(): Promise<number> {
  openingFlowTab ??= findOrOpenFlowTab().finally(() => {
    openingFlowTab = null;
  });
  return openingFlowTab;
}

/** VidFlow's own Flow tab and its address, only if it is open now (never opens one). */
export async function currentFlowTab(): Promise<{ tabId: number; url: string } | null> {
  const saved = await savedFlowWindow();
  if (!saved) return null;
  try {
    const tab = await chrome.tabs.get(saved.tabId);
    const url = tab.pendingUrl ?? tab.url;
    return tab.windowId === saved.windowId && isFlowUrl(url) ? { tabId: saved.tabId, url: url! } : null;
  } catch {
    return null;
  }
}

/** VidFlow's own Flow tab, opening its window on Flow's home page if there is none (no Flow project is made). */
export const openFlowTab = (): Promise<number> => ensureFlowTab();

async function findOrOpenFlowTab(): Promise<number> {
  const saved = await savedFlowWindow();
  if (saved) {
    try {
      const tab = await chrome.tabs.get(saved.tabId);
      if (tab.windowId === saved.windowId && (isFlowUrl(tab.url) || isFlowUrl(tab.pendingUrl))) {
        await resetZoom(saved.tabId);
        return saved.tabId;
      }
    } catch {
      // The tab is gone; open a new window below.
    }
    await forgetFlowWindow();
  }
  const created = await chrome.windows.create({ url: FLOW_URL, focused: false, type: 'normal' });
  const tabId = created?.tabs?.[0]?.id;
  if (created?.id === undefined || tabId === undefined) throw new Error('no window');
  await chrome.storage.local.set({ [WINDOW_KEY]: { windowId: created.id, tabId } satisfies FlowWindow });
  await resetZoom(tabId);
  return tabId;
}

/**
 * Flow ignores debugger presses while VidFlow's tab is not the active tab of its window (plan-1b live check). Right
 * before every press, bring the tab to the front of its own window — only if it isn't already, and never by focusing
 * the window (the owner keeps working wherever they are).
 */
async function frontTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) await chrome.tabs.update(tabId, { active: true });
  } catch {
    // The tab is gone; the press fails and the run pauses as usual.
  }
}

/** Every press goes through here: the tab is made active in its window first. */
async function pressIn(tabId: number, x: number, y: number): Promise<void> {
  await frontTab(tabId);
  await port!.press(tabId, x, y);
}

/**
 * Page zoom changes what CSS pixels mean to the debugger's input; keep VidFlow's tab at 100% (the port scales
 * otherwise). Zoom is per-site by default, so the tab is made per-tab first: the owner's other Flow tabs keep theirs.
 */
async function resetZoom(tabId: number): Promise<void> {
  try {
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
  } catch {
    return; // Not per-tab: setting the zoom would change every Flow tab. The port scales by getZoom instead.
  }
  try {
    await chrome.tabs.setZoom(tabId, 1);
  } catch {
    // The port scales by getZoom instead.
  }
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.pendingUrl ?? tab.url;
  } catch {
    return undefined;
  }
}

/** Polls the tab until its URL satisfies `ok`; returns that URL, or null after timings.urlWaitMs. */
async function waitForUrl(tabId: number, ok: (url: string) => boolean, waitMs = timings.urlWaitMs): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const url = await tabUrl(tabId);
    if (url && ok(url)) return url;
    if (Date.now() >= deadline) return null;
    await sleep(timings.urlPollMs);
  }
}

// ---- State changes -------------------------------------------------------

/**
 * A scene in Flow has a 10-minute deadline only while the run is running: a pause clears them all, and Resume arms a
 * fresh 10 minutes for each (results are still collected while paused; see matchOnce).
 */
const armedDeadlines = (s: RunState | null) => new Set(s?.status === 'running' ? s.inFlight : []);

async function syncDeadlines(prev: RunState | null, next: RunState): Promise<void> {
  const before = armedDeadlines(prev);
  const after = armedDeadlines(next);
  for (const id of before) if (!after.has(id)) await chrome.alarms.clear(DEADLINE_PREFIX + id);
  for (const id of after) {
    if (!before.has(id)) await chrome.alarms.create(DEADLINE_PREFIX + id, { delayInMinutes: DEADLINE_MINUTES });
  }
}

function announce(prev: RunState | null, next: RunState): void {
  if (prev?.status === next.status) return;
  if (next.status === 'paused' && next.pauseReason && next.pauseReason !== USER_PAUSE_REASON) {
    notify(typeof next.resumeAt === 'number' ? next.pauseReason : `VidFlow paused: ${next.pauseReason}`);
  } else if (next.status === 'finished' && isHeroSheetRun(next)) {
    notify(
      runSummary(next).done > 0
        ? 'The model sheet is ready. Pick the hero reference in VidFlow.'
        : 'The model sheet needs a look — open VidFlow.',
    );
  } else if (next.status === 'finished' && isClipRun(next)) {
    const { done } = runSummary(next);
    const total = Object.keys(next.sceneStates).length;
    notify(done === total ? `Clips are ready for all ${total} slides.` : `Clips are ready for ${done} of ${total} slides. The others keep their pictures — open VidFlow.`);
  } else if (next.status === 'finished') {
    const { done, refused, failed } = runSummary(next);
    const total = Object.keys(next.sceneStates).length;
    const needLook = refused.length + failed.length;
    notify(
      needLook === 0
        ? `Pictures are ready for all ${total} scenes.`
        : `Pictures are ready for ${done} of ${total} scenes. ${needLook} need a look — open VidFlow.`,
    );
  }
}

/** Must be called inside the queue. */
async function commit(next: RunState): Promise<void> {
  const prev = state;
  state = next;
  await chrome.storage.local.set({ [RUN_KEY]: next });

  // Read and write the project in one transaction so edits made in the studio or panel meanwhile (and pictures marked
  // downloaded) are never overwritten; only sceneStates (or, for a model sheet run, heroSheet) is ours. The sheet never
  // goes into sceneStates: it isn't a scene.
  const project = await updateProject(next.projectId, (project) => {
    if (isHeroSheetRun(next)) {
      const sheet = next.sceneStates[HERO_SHEET_ID];
      if (sheet) {
        project.heroSheet = {
          status: sheet.status,
          pictureIds: sheet.pictureIds,
          ...(sheet.message ? { message: sheet.message } : {}),
          ...(next.sheet ? { aspect: next.sheet.aspect } : {}),
        };
      }
    } else if (isClipRun(next)) {
      // A clip run's states are the clips' progress: only each slide's clip and its note are saved; the pictures and
      // their status stay as they are.
      const states = { ...project.sceneStates };
      for (const [id, r] of Object.entries(next.sceneStates)) {
        const saved = states[id];
        if (!saved) continue;
        const { clipNote: _old, ...rest } = saved;
        const clipNote = r.status === 'failed' || r.status === 'refused' ? r.message : undefined;
        states[id] = { ...rest, ...(r.status === 'done' && r.clip ? { clip: r.clip } : {}), ...(clipNote ? { clipNote } : {}) };
      }
      project.sceneStates = states;
    } else project.sceneStates = { ...project.sceneStates, ...next.sceneStates };
  });
  if (project) noteChanges(prev, next, project);
  if (next.status !== 'running') setStep(null).catch((err) => console.warn('[VidFlow] step clear failed', err));

  if (next.status === 'running') {
    if (await getKeepAwake()) chrome.power.requestKeepAwake('system');
    else chrome.power.releaseKeepAwake();
  } else {
    chrome.power.releaseKeepAwake();
    // Drop the debugger (and Chrome's "started debugging" bar) whenever the run is not pressing Generate.
    const flow = await savedFlowWindow();
    if (flow) await detachFlowDebugger(flow.tabId);
  }

  if (next.status === 'paused' && typeof next.resumeAt === 'number') {
    await chrome.alarms.create(RESUME_ALARM, { when: next.resumeAt });
  } else {
    await chrome.alarms.clear(RESUME_ALARM);
  }
  await syncDeadlines(prev, next);
  announce(prev, next);
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A listener's failure (e.g. no studio tab open) never stops the run.
    }
  }
}

async function dispatch(event: RunEvent): Promise<void> {
  await ready;
  await enqueue(async () => {
    if (!state) return;
    await commit(reduceRun(state, normaliseEvent(event, Date.now())));
  });
  void pump();
  void processTiles();
  void clipPoll();
}

/** `sceneId`: the slide the pause is about (the owner may Skip it while paused). */
function pauseWith(message: string, sceneId?: string): Promise<void> {
  return dispatch({ type: 'needsOwner', reason: 'page-not-recognised', message, ...(sceneId ? { sceneId } : {}) });
}

// ---- Submitting ----------------------------------------------------------

/** True while the run that the pump is working for is still running. Checked right before every Generate press. */
function stillRunning(projectId: string): boolean {
  return state?.status === 'running' && state.projectId === projectId;
}

/** Still waiting to be sent (not skipped meanwhile): Generate is only pressed for such a scene. */
function stillPending(sceneId: string): boolean {
  return state?.sceneStates[sceneId]?.status === 'pending';
}

/** True while this run is running or paused: results already in Flow are still collected (nothing new is sent). */
function stillCollecting(projectId: string): boolean {
  return (state?.status === 'running' || state?.status === 'paused') && state.projectId === projectId;
}

export const ACCEPTED_NOTICE_TEXT = "Accepted Flow's notice";

/**
 * Consecutive Generate presses per scene that Flow answered with its notice. The first is accepted; a second in a row
 * pauses (like pastNotice's one retry), so a notice that keeps coming back can't press Generate forever.
 */
const postPressNotices = new Map<string, number>();

/**
 * A usage notice seen while the run only waits for tiles (no prepare to find it) is accepted at most this many times
 * between prompts Flow takes (and per Start or Resume); one more pauses, so a notice that keeps coming back can't loop.
 */
export const MAX_WAITING_NOTICES = 3;
let waitingNotices = 0;

function logAcceptedNotice(projectId: string, sceneId: string | null): void {
  logActivity({ at: Date.now(), projectId, sceneId, text: ACCEPTED_NOTICE_TEXT }).catch((e) =>
    console.warn('[VidFlow] activity write failed', e),
  );
}

/**
 * Runs a Flow step (prepare, or finding New project). When Flow's usage-policy / rights notice blocked it and "Accept
 * Flow's notices automatically" is on, accepts the notice, logs it, and runs the step once more. Anything else (a
 * billing dialog, the switch off, a notice that couldn't be accepted or is still there) throws as before, so the run
 * pauses with the existing message.
 */
async function pastNotice<T>(tabId: number, projectId: string, sceneId: string | null, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (!(err instanceof FlowBlockedError) || !err.notice || !(await getAcceptNotices())) throw err;
    const accepted = await port!.acceptNotice(tabId).catch(() => null);
    if (accepted === false) throw err;
    // No answer (the page reloaded) still gets its one retry: if the notice is there, the retry pauses as before.
    if (accepted === true) logAcceptedNotice(projectId, sceneId);
    return step();
  }
}

/**
 * Puts the Flow tab on this run's own project, creating a fresh one on the run's first scene (spec §16.5).
 * Returns false when the run stopped meanwhile (no Generate press follows). Throws FlowBlockedError when the owner must act.
 */
async function ensureFlowProject(tabId: number, projectId: string, onOpened?: () => void): Promise<boolean> {
  const action = flowProjectAction(state?.flowProjectUrl, await tabUrl(tabId));
  if (action.kind === 'ok') return true;
  if (action.kind === 'navigate') {
    await chrome.tabs.update(tabId, { url: action.url });
    if (!(await waitForUrl(tabId, (u) => projectUrlOf(u) === action.url))) {
      throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: NO_PROJECT_MESSAGE });
    }
    return true;
  }
  if (action.goHome) {
    await chrome.tabs.update(tabId, { url: FLOW_URL });
    await waitForUrl(tabId, isFlowHome);
  }
  const at = await pastNotice(tabId, projectId, null, () => port!.findNewProject(tabId, PUMP_VERB));
  if (!stillRunning(projectId)) return false;
  await pressIn(tabId, at.x, at.y);
  if (!stillRunning(projectId)) await detachFlowDebugger(tabId); // paused or stopped during the press
  const url = await waitForUrl(tabId, (u) => projectUrlOf(u) !== null);
  const flowProjectUrl = projectUrlOf(url ?? undefined);
  if (!flowProjectUrl) {
    throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: NO_PROJECT_MESSAGE });
  }
  await enqueue(async () => {
    if (state?.projectId === projectId) await commit({ ...state, flowProjectUrl });
  });
  // The last tiles seen were the old Flow project's: never match this run's prompts against them (a re-made sheet or
  // scene sends the same prompt, and an old refused tile would refuse it at once). The new page reports its own.
  latestReport = { id: latestReport.id + 1, at: Date.now(), cards: [] };
  onOpened?.();
  return stillRunning(projectId); // paused or stopped meanwhile: the project is kept, nothing more is typed
}

const isFinished = (c: FlowResultCard) => c.imageUrl !== null && c.progress === null && !c.key.startsWith('pending-');
/** A skipped submission's place in matching: never a scene id. */
const SKIPPED_SLOT = 'skipped:';
/** Skipped submissions still within a scene's deadline (older ones are closed: Flow won't draw them now). */
const liveSkipped = (run: RunState, now: number) => (run.skippedPrompts ?? []).filter((x) => now - x.at < DEADLINE_MINUTES * 60_000);
const oldestFirst = (cards: FlowResultCard[]) => [...cards].sort((a, b) => b.domIndex - a.domIndex);

/** Flow card keys already saved for a scene, or the hero reference's own tile; never matched to a scene. */
function claimedKeys(s: RunState): Set<string> {
  // A clip run's finished tiles are keyed by poster and claimed for good (saved with the run).
  if (isClipRun(s)) return new Set(Object.keys(s.clipClaims ?? {})); // lasting: kept with the run
  return new Set([...Object.values(s.sceneStates).flatMap((x) => x.cardKeys ?? []), ...(s.reference?.cardKeys ?? [])]);
}

/** The uploaded hero reference's grid tile keeps its file name as caption: never a scene's picture, even unrecorded. */
const notReference = (s: RunState) => (c: FlowResultCard) => !s.reference || !c.caption.includes(s.reference.name);

const REFERENCE_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** vidflow-hero-<first 8 characters of the Flow project id>.<ext>: one per Flow project, recognisable in its assets. */
function referenceName(flowProjectUrl: string, type: string): string {
  const id = (flowProjectUrl.split('/project/')[1] ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return `vidflow-hero-${id}.${REFERENCE_EXTENSION[type] ?? 'png'}`;
}

/**
 * Once per run, right after its fresh Flow project opens (or on Resume if that didn't finish): uploads the hero's
 * reference picture into it. Returns its asset name for prepare to attach, or null for a hero without a reference
 * (hero-sheet runs never have one). Throws FlowBlockedError when the owner must act. Holds the tab.
 */
async function ensureReference(tabId: number, project: Project): Promise<string | null> {
  // The model sheet is how a reference is made: its run never uploads or attaches one, even if the hero has one. A
  // clip run's start frame is the slide's own picture.
  if (!isSceneRun(state)) return null;
  const mediaId = project.character?.referenceMediaId;
  const flowProjectUrl = state?.flowProjectUrl;
  if (!mediaId || !state || !flowProjectUrl) return null;
  if (state.reference?.flowProjectUrl === flowProjectUrl) return state.reference.name;
  const image = await getMediaStore()
    .get(mediaId)
    .catch(() => undefined);
  if (!image) throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: REFERENCE_MISSING_MESSAGE });
  if (!stillRunning(project.id)) return null; // paused or stopped meanwhile: submitScene stops before typing
  const name = referenceName(flowProjectUrl, image.type);
  note(project, null, 'Adding the hero reference picture to Flow', 'project');
  let key: string | null;
  try {
    key = await pastNotice(tabId, project.id, null, () => port!.uploadReference(tabId, name, image));
  } catch (err) {
    // Without the reference no scene may be sent (its prompt names it): pause, never fail the scene.
    if (err instanceof FlowBlockedError) throw err;
    throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: REFERENCE_ATTACH_MESSAGE });
  }
  const reference = { name, flowProjectUrl, cardKeys: key ? [key] : [] };
  await enqueue(async () => {
    if (state?.projectId === project.id && state.flowProjectUrl === flowProjectUrl) await commit({ ...state, reference });
  });
  return name;
}

// ---- Clips (spec §20, spike S8) ------------------------------------------

export const CLIPS_BUSY_MESSAGE = 'VidFlow is making clips right now. Wait for it to finish, then try again.';
export const CLIPS_PAUSED_MESSAGE = 'Making clips is paused. Resume or stop it, then try again.';
/** Make clips can't start while this same video's pictures are being made. */
export const CLIPS_SCENES_BUSY = 'This video is making pictures right now. Wait for it to finish, then make clips.';
export const NOTHING_TO_CLIP_MESSAGE = 'No slide needs a clip. Pick slides for clips first.';
export const CLIP_LIMIT_MESSAGE = 'Set a credit limit of 0 or more for this run.';
const NO_MOTION_PORT_MESSAGE = "VidFlow can't make clips in Flow yet. Open VidFlow again, then press Resume.";
const CREDITS_UNREADABLE_MESSAGE = "VidFlow can't read your Flow credits. Check the Flow window, then press Resume.";
const COST_UNREADABLE_MESSAGE = "VidFlow can't read what this clip costs in Flow. Check the Flow window, then press Resume.";
const CLIP_PICTURE_MISSING = "VidFlow can't find this slide's picture. Make its pictures again, then make clips.";
const CLIP_SAVE = "Couldn't save this clip.";
const CLIP_FILE = "VidFlow couldn't get this clip's file from Flow.";
const CLIP_UNCONFIRMED = "VidFlow couldn't confirm which clip belongs to this slide.";
const CLIP_UNTRUSTED = "Flow gave VidFlow a clip from an address it doesn't trust, so it wasn't saved.";
const CLIP_UNFINISHED = "Flow didn't finish this clip in 10 minutes.";
/** The press of Generate itself failed: Flow may have taken it. */
/** Still unsure after the wait limit whether Flow started a slide's clip: never pressed again on a guess. */
export const CLIP_UNSURE_MESSAGE =
  "VidFlow couldn't tell whether Flow started this clip. Check the Flow window, then press Resume — or Skip this slide.";
export const CLIP_PRESS_MESSAGE =
  "VidFlow may have pressed Generate for this clip but couldn't tell. Check the Flow window, then press Resume (VidFlow looks for the clip before pressing again).";

/** A clip's failure, saying what making it again costs (Flow doesn't refund: spec §20 settled 7). */
function clipFailure(sceneId: string, what: string): string {
  const job = state?.clips?.[sceneId];
  return job ? `${what} Making it again costs ${CLIP_COST[job.length]} credits.` : what;
}

/** A clip run's result key → the Flow tab's own key for that tile now (grid position: changes as tiles are added). */
let clipTileKeys = new Map<string, string>();

/**
 * A finished clip's lasting key: its poster's address path (flow.google.com/asb/<token>), any =… size suffix left out.
 * It stays the same across page reloads (checked live, 6 Nov), unlike the tile's place in the grid.
 */
function posterKey(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/=.*$/, '');
    return u.protocol === 'https:' && path.length > 1 ? `poster:${u.hostname}${path}` : null;
  } catch {
    return null;
  }
}

/** Flow's browser download of a clip VidFlow fetched itself (registerCoordinator makes it). */
let flowDownloads: ReturnType<typeof createFlowDownloadGuard> | null = null;

/** Every clip prompt ends with the fixed line (spec §20): a drawing clip's caption is its prompt, so it shows. */
const CLIP_CAPTION = /keep the exact same drawing style/i;

/**
 * A picture tile in a clip run's Flow project: an uploaded start frame (or Auto-pick picture), captioned with its file
 * name, never a clip. A finished picture tile that isn't captioned with a clip prompt counts as one too; a drawing
 * clip (captioned with its prompt) never does, even if Flow shows its start frame in it.
 */
const isUploadTile = (c: FlowResultCard) =>
  c.video !== true &&
  (/\bvidflow-s\d+/i.test(c.caption) ||
    (c.imageUrl !== null && c.progress === null && c.refusal === null && !c.key.startsWith('pending-') && !CLIP_CAPTION.test(c.caption)));

/**
 * A clip run's result tiles, uploads left out. Flow gives finished clips no media id: each is keyed by its poster
 * (posterKey), which never changes, so claims and checked prompts stay with it. A tile still drawing (no poster yet) gets
 * a place key for this read only. The Flow tab's own key is kept to open the tile.
 */
function clipCards(cards: FlowResultCard[]): FlowResultCard[] {
  const kept = [...cards].filter((c) => !isUploadTile(c)).sort((a, b) => a.domIndex - b.domIndex);
  const keys = new Map<string, string>();
  const out = kept.map((c, domIndex) => {
    const age = kept.length - 1 - domIndex;
    const poster = c.video === true ? posterKey(c.imageUrl) : null;
    const key = poster ?? (c.refusal !== null ? `pending-refused-${age}` : `pending-${age}`);
    keys.set(key, c.key);
    // A finished clip without a poster yet counts as still drawing (it can't be keyed).
    return { ...c, key, domIndex, imageUrl: poster ? c.imageUrl : c.video === true ? null : c.imageUrl };
  });
  clipTileKeys = keys;
  return out;
}

/** The run's result tiles in the Flow tab now: pictures, or for a clip run its clips. */
async function runTiles(tabId: number): Promise<FlowResultCard[]> {
  if (!isClipRun(state)) return port!.tiles(tabId);
  const m = motionPort();
  return m ? clipCards(await m.videoTiles(tabId)) : [];
}

/**
 * Once per clip run, before its first clip, on the Flow project's grid page: Flow's credit balance (spec §20 settled
 * 2). Spending is tracked from then on; the balance is never re-read mid-run (Flow updates it late, S8). Holds the tab.
 */
async function ensureBalance(tabId: number, project: Project): Promise<boolean> {
  if (state?.balance !== undefined) return true;
  const m = motionPort();
  if (!m) throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: NO_MOTION_PORT_MESSAGE });
  note(project, null, 'Reading your Flow credits', 'project');
  const balance = await pastNotice(tabId, project.id, null, () => m.creditBalance(tabId));
  if (!balance) throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: CREDITS_UNREADABLE_MESSAGE });
  await dispatch({ type: 'balance', credits: balance.credits });
  return stillRunning(project.id);
}

/**
 * Sets Flow up for one slide's clip: uploads its chosen picture as vidflow-s<NN>.png, sets Video · Frames · aspect ·
 * 720p · length · x1, attaches the picture to Start and types the motion prompt; then reads what Generate will cost.
 * 'stop' when the run stopped (or the credits ran out: the run then finishes), 'next' when the slide failed or was
 * skipped meanwhile. Holds the tab.
 */
async function prepareClipFor(
  tabId: number,
  project: Project,
  sceneId: string,
  prompt: string,
): Promise<{ at: Point; cost: number } | 'stop' | 'next'> {
  const projectId = project.id;
  const job = state?.clips?.[sceneId];
  const m = motionPort();
  if (!m) throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: NO_MOTION_PORT_MESSAGE });
  if (!job) {
    await dispatch({ type: 'failed', sceneId, message: CLIP_PICTURE_MISSING });
    return 'next';
  }
  const aspect = project.aspect;
  if (aspect !== '16:9' && aspect !== '9:16') {
    throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: CLIP_ASPECT_MESSAGE });
  }
  const image = await getMediaStore()
    .get(job.pictureId)
    .catch(() => undefined);
  if (!image) {
    await dispatch({ type: 'failed', sceneId, message: CLIP_PICTURE_MISSING });
    return 'next';
  }
  const name = startFrameName(project, sceneId);
  note(project, sceneId, 'Adding the picture as the start frame', 'project');
  await pastNotice(tabId, projectId, sceneId, () => m.uploadStartFrame(tabId, name, image));
  if (!stillRunning(projectId)) return 'stop';
  if (!stillPending(sceneId)) return 'next';
  note(project, null, `Set Flow to Video · Frames · ${aspect} · 720p · ${job.length}s · x1`, 'setting');
  note(project, sceneId, 'Making clip', 'prompt');
  const at = await pastNotice(tabId, projectId, sceneId, () =>
    m.prepareClip(tabId, prompt, { aspect, length: job.length, startFrame: name, verb: PUMP_VERB }),
  );
  if (!stillRunning(projectId)) return 'stop';
  if (!stillPending(sceneId)) return 'next';
  const cost = await m.generateCost(tabId);
  if (cost === null) throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: COST_UNREADABLE_MESSAGE });
  const spent = state?.spent ?? 0;
  // Stop before a clip that would pass the run's limit or what Flow had left (spec §20 settled 7): the run finishes.
  const stop = spent + cost > (state?.limit ?? 0) ? CREDIT_LIMIT_NOTE : state?.balance !== undefined && spent + cost > state.balance ? BALANCE_NOTE : null;
  if (stop) {
    note(project, sceneId, stop === CREDIT_LIMIT_NOTE ? `Credit limit reached (${spent} of ${state?.limit ?? 0} used)` : `Not enough Flow credits left (${spent} of ${state?.balance ?? 0} used)`);
    await dispatch({ type: 'outOfCredits', message: stop, sceneId });
    return 'stop';
  }
  return { at, cost };
}

/** What a clip's page showed: its prompt and (when asked for) its file. */
interface ClipPage {
  prompt: string;
  file: ClipFile | null;
}

/**
 * Reads the clip page the tab is on; takes its file (Download media → 720p Original size, Flow's own browser download
 * cancelled) only when `wantFile` says the prompt is one VidFlow is waiting for. null when the page showed no prompt.
 */
const readClipPage =
  (tabId: number, wantFile: (prompt: string) => boolean) =>
  async (): Promise<ClipPage | null> => {
    const m = motionPort();
    if (!m) return null;
    // The page shows no start-frame name (its rail lists every upload by name): the prompt is all it says.
    const { prompt } = await m.readVideoDetail(tabId);
    if (!prompt) return null;
    let file: ClipFile | null = null;
    if (wantFile(prompt)) {
      flowDownloads?.expect();
      file = await m.clipFile(tabId);
    }
    return { prompt, file };
  };

/**
 * Collects one finished clip the matcher placed for `sceneId` (by submission order and checked prompts, as for pictures:
 * slides sharing a prompt are told apart by order, src/flow/match.ts). Its page is opened to read the prompt (only once:
 * kept by poster key in run.detailPrompts) and, when that is the slide's prompt, to take its file, which is then saved.
 * 'wait' ends this pass (stopped, or try again on the next tile report); otherwise something changed.
 */
async function collectClip(tabId: number, project: Project, run: RunState, sceneId: string, key: string, attempt: number): Promise<'wait' | 'changed'> {
  const expected = run.sceneStates[sceneId]?.submission?.prompt ?? '';
  const known = run.detailPrompts?.[key];
  if (known !== undefined && !verifyMatch(expected, known)) return 'wait'; // matching never places it so
  if (unreadCount.get(key)?.attempt === attempt) return 'wait'; // already tried on this report
  if (run.status !== 'running' && (unreadCount.get(key)?.count ?? 0) >= GIVE_UP_AFTER - 1) return 'wait';
  // Matched: its deadline waits while it is checked and saved.
  if (run.sceneStates[sceneId]?.submission?.clipKey !== key) await dispatch({ type: 'clipMatched', sceneId, key });
  note(project, sceneId, `Checking clip ${sceneNumber(project, sceneId)} matches its prompt`, 'tile', key);
  const isTheSlides = (prompt: string) => verifyMatch(expected, prompt);
  const page = await visitTile(tabId, run.projectId, key, readClipPage(tabId, isTheSlides));
  if (!stillCollecting(run.projectId) || page === SKIPPED || !state) return 'wait';
  const strike = async (what: string): Promise<'wait' | 'changed'> => {
    const tries = (unreadCount.get(key)?.count ?? 0) + 1;
    unreadCount.set(key, { count: tries, attempt });
    if (tries < GIVE_UP_AFTER || state?.status !== 'running') return 'wait';
    unreadCount.delete(key);
    if (known === undefined && what === CLIP_UNCONFIRMED) await dispatch({ type: 'detail', cardKey: key, prompt: '' });
    // A tile whose prompt checked out is this slide's, even when the slide fails on it: no other slide takes it.
    if (what !== CLIP_UNCONFIRMED) await dispatch({ type: 'clipClaim', key, sceneId });
    await dispatch({ type: 'failed', sceneId, message: clipFailure(sceneId, what) });
    return 'changed';
  };
  if (page === null) return strike(CLIP_UNCONFIRMED);
  if (known === undefined) await dispatch({ type: 'detail', cardKey: key, prompt: page.prompt });
  if (!isTheSlides(page.prompt)) return 'changed'; // another slide's: matching places it with what its page said
  if (!page.file) return strike(CLIP_FILE);
  unreadCount.delete(key);
  const again = async (): Promise<ClipFile | null> => {
    const fresh = await visitTile(tabId, run.projectId, key, readClipPage(tabId, isTheSlides));
    return fresh && fresh !== SKIPPED && isTheSlides(fresh.prompt) ? fresh.file : null;
  };
  await saveClip(project, sceneId, key, page.file, again);
  return 'changed';
}

/**
 * Fetches a verified clip's file (signed flow-content.google address, background only), measures its length from its
 * own mvhd box, stores it as scene-NN-clip.mp4 and records the clip with the part the slide uses. A failed fetch or
 * length read opens the clip page once more for a freshly signed address (`again`) before the slide fails.
 */
async function saveClip(
  project: Project,
  sceneId: string,
  key: string,
  first: ClipFile,
  again: () => Promise<ClipFile | null>,
): Promise<void> {
  const job = state?.clips?.[sceneId];
  const wanted = () => state?.projectId === project.id && state.inFlight.includes(sceneId);
  if (!job || !wanted()) return;
  // The tile's prompt checked out: it stays this slide's when the slide fails on it (no other slide takes it).
  const fail = async (what: string) => {
    await dispatch({ type: 'clipClaim', key, sceneId });
    await dispatch({ type: 'failed', sceneId, message: clipFailure(sceneId, what) });
  };
  let file: ClipFile | null = first;
  for (let tryNo = 1; file; tryNo++) {
    if (!isFlowPictureUrl(file.url)) return void (await fail(CLIP_UNTRUSTED));
    // One Flow clip (media id) is never saved for two slides: one already saved for another slide is that slide's
    // tile; it is recorded so and passed over, and this slide waits for its own.
    const id = file.mediaId;
    const owner = state?.flowMediaIds?.[id] ?? Object.entries(state?.sceneStates ?? {}).find(([, s]) => s.clip?.flowMediaId === id)?.[0];
    if (owner && owner !== sceneId) return void (await dispatch({ type: 'clipClaim', key, sceneId: owner }));
    let bytes: ArrayBuffer | null = null;
    try {
      const res = await fetch(file.url);
      if (res.ok) bytes = await res.arrayBuffer();
    } catch {
      bytes = null;
    }
    const length = bytes ? mp4Duration(bytes) : null;
    if (!wanted()) return;
    if (bytes && length !== null && length > 0) {
      try {
        const nn = String(project.scenes.findIndex((s) => s.id === sceneId) + 1).padStart(2, '0');
        const mediaId = await getMediaStore().put(project.id, `scene-${nn}-clip.mp4`, new Blob([bytes], { type: 'video/mp4' }));
        const clip = { mediaId, sourcePictureId: job.pictureId, length, use: useRange(job.seconds, length), flowMediaId: id };
        await dispatch({ type: 'clip', sceneId, clip, cardKey: key });
      } catch {
        await fail(CLIP_SAVE);
      }
      return;
    }
    if (tryNo >= 2) break;
    file = await again(); // the signed address may have run out: the page gives a fresh one
    if (!wanted()) return;
  }
  await fail(CLIP_SAVE);
}

let clipPolling = false;
/**
 * While a clip run is live, asks the Flow tab for its video tiles every few seconds: the page's own tile reports
 * describe pictures only, and a drawing clip may change nothing they show.
 */
async function clipPoll(): Promise<void> {
  if (clipPolling) return;
  clipPolling = true;
  try {
    await ready;
    while (state && isClipRun(state) && (state.status === 'running' || state.status === 'paused')) {
      if (state.inFlight.length > 0) await pullTiles();
      await sleep(timings.clipPollMs);
    }
  } finally {
    clipPolling = false;
  }
}

/**
 * Sends one scene to Flow. Holds the tab. 'stop' ends this pump round (paused, stopped, or blocked); the scene stays
 * pending unless Flow confirmed the start.
 */
async function submitScene(tabId: number, project: Project, sceneId: string, prompt: string): Promise<'stop' | 'next'> {
  submitting = sceneId;
  try {
    return await sendScene(tabId, project, sceneId, prompt);
  } finally {
    submitting = null;
  }
}

async function sendScene(tabId: number, project: Project, sceneId: string, prompt: string): Promise<'stop' | 'next'> {
  const projectId = project.id;
  let pressing = false;
  try {
    if (!(await ensureFlowProject(tabId, projectId, () => note(project, null, 'Opened a new Flow project', 'project')))) return 'stop'; // stopped meanwhile; scene stays pending
    const clips = isClipRun(state);
    const reference = clips ? null : await ensureReference(tabId, project);
    if (clips && !(await ensureBalance(tabId, project))) return 'stop';
    if (!stillRunning(projectId)) return 'stop';
    const unconfirmed = state?.sceneStates[sceneId]?.unconfirmed;
    if (unconfirmed) {
      // A press whose start VidFlow didn't see may still have worked: look before pressing again (no surplus batch).
      const found = clips ? await findUnconfirmedClip(tabId, project, sceneId, unconfirmed) : await findUnconfirmedStart(tabId, project, unconfirmed);
      if (found === null) return 'stop';
      if (found === 'wait') {
        // Look again after the pace pause, without pressing; but a tile that never finishes can't stall the run.
        if (unconfirmed.at === undefined) {
          await dispatch({
            type: 'unconfirmed',
            sceneId,
            keysBefore: unconfirmed.keysBefore,
            prompt: unconfirmed.prompt,
            ...(unconfirmed.othersBefore !== undefined ? { othersBefore: unconfirmed.othersBefore } : {}),
          });
        } else if (Date.now() - unconfirmed.at >= timings.unconfirmedWaitMs) {
          // A clip is never pressed again on a guess (nor failed: its press may be in Flow): the owner looks.
          if (clips) {
            await pauseWith(CLIP_UNSURE_MESSAGE, sceneId);
            return 'stop';
          }
          await dispatch({ type: 'failed', sceneId, message: UNCONFIRMED_MESSAGE });
        }
        return 'next';
      }
      if (found) {
        postPressNotices.delete(sceneId); // Flow did start it after all
        await dispatch({ type: 'submitted', sceneId, prompt: unconfirmed.prompt, at: Date.now() });
        return 'next';
      }
    }
    let at: Point;
    let cost = 0;
    if (clips) {
      const clip = await prepareClipFor(tabId, project, sceneId, prompt);
      if (clip === 'stop' || clip === 'next') return clip;
      ({ at, cost } = clip);
    } else {
      const n = outputsOf(state, project);
      const aspect = aspectOf(state, project);
      note(project, null, `Set Flow to Image · ${aspect} · ${pictures(n)}`, 'setting');
      note(project, sceneId, 'Typing the prompt', 'prompt');
      at = await pastNotice(tabId, projectId, sceneId, () =>
        port!.prepare(tabId, sceneId, prompt, {
          aspect,
          outputs: n,
          verb: PUMP_VERB,
          ...(reference ? { reference: { name: reference } } : {}),
        }),
      );
    }
    // Preparing can take ~40 s: if the owner paused (or the run ended) meanwhile, don't press; the scene stays pending.
    if (!stillRunning(projectId)) return 'stop';
    if (!stillPending(sceneId)) return 'next'; // skipped while it was typed: never pressed
    const tilesBefore = await runTiles(tabId);
    const keysBefore = tilesBefore.filter(isFinished).map((c) => c.key);
    // A clip run also counts the tiles still drawing (no poster key yet): they are older than this press.
    const othersBefore = clips ? tilesBefore.length - keysBefore.length : undefined;
    if (!stillRunning(projectId)) return 'stop';
    // Recorded before the press: if the worker is suspended before Flow's start is confirmed, the next pump looks for
    // this scene's tiles before pressing again (no surplus batch). `submitted` clears it. A clip's credits count from
    // the press, whatever Flow then does with it (spec §20 settled 7: no refunds), so they go in the same step.
    // A press Flow answered with its usage notice was counted already: pressing again for it isn't counted twice.
    const paid = clips ? (state?.sceneStates[sceneId]?.unconfirmed?.paid ?? 0) : 0;
    const charge = Math.max(0, cost - paid);
    const spentBefore = state?.spent ?? 0;
    await dispatch({
      type: 'unconfirmed',
      sceneId,
      keysBefore,
      prompt,
      at: Date.now(),
      ...(clips ? { credits: charge, othersBefore } : {}),
    });
    const counted = clips && charge > 0 && (state?.spent ?? 0) === spentBefore + charge ? charge : 0;
    // The last look before pressing: the tab is brought forward first, so nothing awaits between it and the press.
    await frontTab(tabId);
    if (!stillRunning(projectId) || !stillPending(sceneId)) {
      // Paused, stopped or skipped at the last moment: nothing is pressed, so nothing is spent.
      if (counted) await dispatch({ type: 'spent', credits: -counted });
      return stillRunning(projectId) ? 'next' : 'stop';
    }
    note(project, sceneId, 'Pressing Generate', 'generate');
    // Set until Flow's start is recorded: a throw after the press must never fail a slide whose press reached Flow.
    pressing = true;
    await port!.press(tabId, at.x, at.y);
    if (!stillRunning(projectId)) await detachFlowDebugger(tabId);
    const started = await port!.confirmStarted(tabId);
    if (started === 'notice') {
      // Flow answered Generate with its usage notice. Accepted (once in a row per scene): the scene stays unconfirmed,
      // so the next round looks for its tiles before pressing again (findUnconfirmedStart). Otherwise the pause names
      // the notice.
      const rounds = (postPressNotices.get(sceneId) ?? 0) + 1;
      postPressNotices.set(sceneId, rounds);
      if (rounds === 1 && (await getAcceptNotices()) && (await port!.acceptNotice(tabId).catch(() => null)) === true) {
        logAcceptedNotice(projectId, sceneId);
        if (clips) await dispatch({ type: 'paid', sceneId, credits: paid + counted });
        return 'next';
      }
      postPressNotices.delete(sceneId); // after the owner's Resume, the next notice gets its one accept again
      await dispatch({ type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage(PUMP_VERB) });
      return 'stop';
    }
    postPressNotices.delete(sceneId); // started (or a different failure): the next notice is a new one
    if (started === 'billing') {
      // Flow answered Generate with a billing or upgrade dialog: VidFlow never touches it. The owner reads it.
      await dispatch({ type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage(PUMP_VERB) });
      return 'stop';
    }
    if (!started) {
      await dispatch({ type: 'needsOwner', reason: 'page-not-recognised', message: NOT_STARTED_MESSAGE });
      return 'stop';
    }
    waitingNotices = 0; // Flow took a prompt: a notice seen while waiting starts its count again
    await dispatch({ type: 'submitted', sceneId, prompt, at: Date.now() });
    pressing = false;
    return 'next';
  } catch (err) {
    // The page needs the owner (wrong account, limit, policy dialog…): pause, and leave the scene queued.
    if (err instanceof FlowBlockedError) {
      await dispatch(err.event);
      return 'stop';
    }
    lastSendError = { sceneId, error: err instanceof Error ? err.message : String(err), at: Date.now() };
    console.warn('[VidFlow] send failed', lastSendError);
    void chrome.storage.local.set({ 'vidflow.lastSendError': lastSendError });
    if (pressing && isClipRun(state)) {
      // The press itself failed: Flow may have taken it (and the credits). The slide stays unconfirmed, so Resume looks
      // for its clip before pressing again; it is never failed (that would invite paying twice).
      await pauseWith(CLIP_PRESS_MESSAGE);
      return 'stop';
    }
    await dispatch({
      type: 'failed',
      sceneId,
      message: "VidFlow couldn't send this scene to Flow. Press Try again to send it again.",
    });
    return 'next';
  }
}

/**
 * A clip run's unconfirmed slides whose last look found no clip of their press, with the press record looked at
 * (its `at`): one look alone never leads to a new press, a second one (after the pace pause) is needed.
 */
const noClipSeen = new Map<string, number>();

/**
 * A clip run's version of findUnconfirmedStart (after a press whose start wasn't seen, or a restart): true when a clip
 * of this press is in Flow. Tiles there at the press never count: the finished ones (keysBefore, poster keys) and the
 * `othersBefore` oldest of the rest, which were still drawing then. Claimed tiles never count either. Of the newer
 * clips with this prompt, slides sharing it that were sent after this press (seq or time) are owed theirs first; a
 * slide sent before it got its clip from the older tiles.
 *
 * Telling the older tiles by place is only safe on a whole grid, and pressing again on a wrong "no" pays twice. So
 * "not started" (false) needs: no fewer tiles than at the press, no checked tile with this prompt left out of the read,
 * no unclaimed tile with this prompt (by its checked prompt, or a drawing tile's caption) anywhere past keysBefore, and
 * the same answer on two looks in a row, and a press Flow never confirmed (a confirmed one is never "not started").
 * Anything less is 'wait' (look again; the run pauses after the wait limit).
 * null when the run stopped meanwhile. Holds the tab.
 */
async function findUnconfirmedClip(
  tabId: number,
  project: Project,
  sceneId: string,
  u: NonNullable<SceneState['unconfirmed']>,
): Promise<boolean | 'wait' | null> {
  const run = state;
  if (!run) return null;
  const claimed = new Set(Object.keys(run.clipClaims ?? {}));
  const before = new Set(u.keysBefore);
  const olderCount = u.othersBefore ?? 0;
  const tiles = oldestFirst(await runTiles(tabId));
  const notBefore = tiles.filter((c) => !before.has(c.key));
  const newer = notBefore.slice(olderCount).filter((c) => !claimed.has(c.key));
  const older = notBefore.slice(0, olderCount).filter((c) => !claimed.has(c.key));
  const later = (seq: number, at: number) => (u.seq !== undefined ? seq > u.seq : at >= (u.at ?? 0));
  const owed =
    run.inFlight.filter((id) => {
      const sub = run.sceneStates[id]?.submission;
      return !!sub && later(sub.seq, sub.at) && verifyMatch(u.prompt, sub.prompt);
    }).length + liveSkipped(run, Date.now()).filter((x) => later(x.seq, x.at) && verifyMatch(u.prompt, x.prompt)).length;
  const attempt = -++unconfirmedAttempt;
  /** Whether a tile carries this prompt: 'drawing' when only its caption says so. */
  const promptOf = async (card: FlowResultCard): Promise<boolean | 'drawing' | 'unread' | null> => {
    if (isFinished(card)) {
      const detail = await detailOf(tabId, project.id, card.key, attempt);
      return detail === null || detail === 'unread' ? detail : verifyMatch(u.prompt, detail);
    }
    if (card.refusal !== null) return verifyMatch(u.prompt, card.caption); // a refused tile keeps its prompt: Flow took it
    return verifyMatch(u.prompt, card.caption) ? 'drawing' : false; // still drawing: its caption alone doesn't prove it
  };
  let hits = 0;
  let generating = 0;
  for (const card of newer) {
    const ok = await promptOf(card);
    if (ok === null) return null;
    if (ok === 'unread') return stillRunning(project.id) ? 'wait' : null;
    if (ok === 'drawing') generating++;
    else if (ok && ++hits > owed) {
      noClipSeen.delete(sceneId);
      return true;
    }
  }
  if (!stillRunning(project.id)) return null;
  let unsure = hits + generating > 0;
  // A tile left out of this read shifts the places: an older tile told by place may be this press's clip.
  const shown = new Set(tiles.map((c) => c.key));
  if (tiles.length < u.keysBefore.length + olderCount) unsure = true;
  for (const [key, prompt] of Object.entries(run.detailPrompts ?? {})) {
    if (!shown.has(key) && !claimed.has(key) && verifyMatch(u.prompt, prompt)) unsure = true;
  }
  for (const card of unsure ? [] : older) {
    const ok = await promptOf(card);
    if (ok === null) return null;
    if (ok !== false) {
      unsure = true;
      break;
    }
  }
  if (!stillRunning(project.id)) return null;
  if (unsure) {
    noClipSeen.delete(sceneId);
    return 'wait';
  }
  // Flow confirmed this press started (before a restart): its clip is in Flow even if no read shows it. Never "not
  // started": look again, and the run pauses for the owner at the wait limit.
  if (u.confirmed) return 'wait';
  // Nothing of this press in a whole grid: once is not enough (Flow can leave a tile out of one read).
  if (noClipSeen.get(sceneId) !== u.at) {
    noClipSeen.set(sceneId, u.at ?? 0);
    return 'wait';
  }
  noClipSeen.delete(sceneId);
  return false;
}

/**
 * Before pressing Generate again for a scene whose start wasn't confirmed: true when Flow has tiles for it after all
 * (a new card whose detail prompt verifies, or an in-progress/refused tile still captioned with its prompt), beyond
 * what in-flight scenes with the same prompt are owed. null when the run stopped meanwhile. Holds the tab.
 */
async function findUnconfirmedStart(
  tabId: number,
  project: Project,
  u: NonNullable<SceneState['unconfirmed']>,
): Promise<boolean | 'wait' | null> {
  if (!state) return null;
  const claimed = claimedKeys(state);
  const before = new Set(u.keysBefore);
  const all = (await runTiles(tabId)).filter((c) => !claimed.has(c.key) && notReference(state!)(c));
  const fresh = oldestFirst(all).filter((c) => !before.has(c.key));
  const outputs = outputsOf(state, project);
  // A skipped submission whose tiles were already in the grid before this press owes nothing new: place the in-flight
  // and skipped submissions on the tiles seen before the press, and count only the skipped ones still open.
  const sameSkipped = liveSkipped(state, Date.now()).filter((x) => verifyMatch(u.prompt, x.prompt));
  let skippedOwed = sameSkipped.length;
  if (skippedOwed > 0) {
    const subs: Submission[] = [
      ...state.inFlight.flatMap((id) => {
        const sub = state?.sceneStates[id]?.submission;
        return sub ? [{ sceneId: id, prompt: sub.prompt, seq: sub.seq, submittedAt: sub.at }] : [];
      }),
      ...sameSkipped.map((x) => ({ sceneId: `${SKIPPED_SLOT}${x.seq}`, prompt: x.prompt, seq: x.seq, submittedAt: x.at })),
    ];
    const placed = matchResults(subs, all.filter((c) => before.has(c.key)), claimed, outputs, state.detailPrompts ?? {});
    skippedOwed -= placed.filter((m) => m.sceneId.startsWith(SKIPPED_SLOT) && m.kind !== 'unconfirmed').length;
  }
  const samePromptInFlight =
    state.inFlight.filter((id) => verifyMatch(u.prompt, state?.sceneStates[id]?.submission?.prompt ?? '')).length + skippedOwed;
  const owedToOthers = samePromptInFlight * outputs;
  let hits = 0;
  let generating = 0;
  const attempt = -++unconfirmedAttempt; // each Resume check is its own attempt (tile reports count up from 1)
  for (const card of fresh) {
    let ok: boolean;
    if (isFinished(card)) {
      const detail = await detailOf(tabId, project.id, card.key, attempt);
      if (detail === null) return null;
      if (detail === 'unread') return stillRunning(project.id) ? 'wait' : null;
      ok = verifyMatch(u.prompt, detail);
    } else if (card.refusal !== null) {
      ok = verifyMatch(u.prompt, card.caption); // a refused tile keeps its prompt as caption: Flow did take it
    } else {
      // Still generating: its caption alone doesn't prove it. Wait for it to finish and check its detail then.
      if (verifyMatch(u.prompt, card.caption)) generating++;
      continue;
    }
    if (ok && ++hits > owedToOthers) return true;
  }
  if (!stillRunning(project.id)) return null;
  return hits + generating > owedToOthers ? 'wait' : false;
}

/**
 * A card's full prompt: known already, or read from its detail view. 'unread' when the detail didn't show this card
 * plainly (try again later); after GIVE_UP_AFTER such reads it is recorded as '' (never matches). null if the run stopped.
 */
async function detailOf(
  tabId: number,
  projectId: string,
  key: string,
  attempt: number,
): Promise<string | 'unread' | null> {
  const clips = isClipRun(state);
  // Clip keys are poster keys too: a finished tile never changes, so its prompt is read once and kept.
  const known = state?.detailPrompts?.[key];
  if (known !== undefined) return known;
  if (unreadCount.get(key)?.attempt === attempt) return 'unread'; // already tried on this report
  // While not running, the last strike is left for after Resume: a paused run doesn't keep opening a tile that won't
  // read (each visit changes the tiles, which would bring the next read) and never gives up on a card.
  if (state?.status !== 'running' && (unreadCount.get(key)?.count ?? 0) >= GIVE_UP_AFTER - 1) return null;
  const read = clips ? await readClipPromptFor(tabId, projectId, key) : await readDetailFor(tabId, projectId, key);
  if (!stillCollecting(projectId)) return null;
  if (read === SKIPPED) return null; // paused with the tab elsewhere: not read, so not a strike against the card
  if (read === null) {
    const tries = (unreadCount.get(key)?.count ?? 0) + 1;
    unreadCount.set(key, { count: tries, attempt });
    if (tries < GIVE_UP_AFTER) return 'unread';
    if (state?.status !== 'running') return null; // never given up on while paused
    await dispatch({ type: 'detail', cardKey: key, prompt: '' });
    return '';
  }
  await dispatch({ type: 'detail', cardKey: key, prompt: read });
  return read;
}

/** A clip tile's page prompt (no file taken). */
async function readClipPromptFor(tabId: number, projectId: string, key: string): Promise<string | null | typeof SKIPPED> {
  const page = await visitTile(tabId, projectId, key, readClipPage(tabId, () => false));
  return page === SKIPPED || page === null ? page : page.prompt;
}

/** readDetailFor didn't try (paused, tab off the project): unlike an unreadable detail, it doesn't count. */
const SKIPPED = Symbol('skipped');

/**
 * Opens a card's detail view in the Flow tab (trusted press on the tile), reads the full prompt, and goes back to the
 * run's project. null when anything doesn't line up; SKIPPED when a paused run's tab is off the project (it is never
 * moved then). Holds the tab.
 */
function readDetailFor(tabId: number, projectId: string, key: string): Promise<string | null | typeof SKIPPED> {
  return visitTile(tabId, projectId, key, async () => {
    const { prompt, mediaId } = await port!.readDetail(tabId);
    // Trust the prompt only when the page's one picture is this card; missing or different means unread.
    return mediaId === key ? prompt : null;
  });
}

/** Opens a result tile's page, reads it with `read`, and goes back to the run's project (see readDetailFor). */
async function visitTile<T>(tabId: number, projectId: string, key: string, read: () => Promise<T | null>): Promise<T | null | typeof SKIPPED> {
  const flowUrl = state?.flowProjectUrl;
  if (!flowUrl || !port || !stillCollecting(projectId)) return null;
  const onProject = (u: string) => projectUrlOf(u) === flowUrl && !/\/edit\//.test(u);
  // A paused run only reads from the project page as it is: it never moves the tab (the owner may be fixing something).
  const start = await tabUrl(tabId);
  if (state?.status !== 'running' && (!start || !onProject(start))) return SKIPPED;
  inDetail = true;
  try {
    const now = await tabUrl(tabId);
    if (!now || !onProject(now)) {
      await chrome.tabs.update(tabId, { url: flowUrl });
      if (!(await waitForUrl(tabId, onProject))) return null;
    }
    // A clip is opened by its place in the grid as the tab shows it now (VidFlow holds the tab: nothing is added).
    const clips = isClipRun(state);
    if (clips) await runTiles(tabId);
    const tileKey = clips ? clipTileKeys.get(key) : key;
    if (!tileKey) return null;
    const at = await port.tilePoint(tabId, tileKey);
    if (!stillCollecting(projectId)) return null;
    await pressIn(tabId, at.x, at.y);
    if (!(await waitForUrl(tabId, (u) => projectUrlOf(u) === flowUrl && /\/edit\//.test(u)))) return null;
    return await read();
  } catch {
    return null;
  } finally {
    try {
      const now = await tabUrl(tabId);
      if (!now || !onProject(now)) {
        // History back keeps Flow's grid (a reload would redraw it from scratch); reload only if that fails.
        let back = false;
        try {
          await chrome.tabs.goBack(tabId);
          back = (await waitForUrl(tabId, onProject, timings.backWaitMs)) !== null;
        } catch {
          back = false;
        }
        if (!back) {
          await chrome.tabs.update(tabId, { url: flowUrl });
          await waitForUrl(tabId, onProject);
        }
      }
    } catch {
      // The pump puts the tab back on the project before its next press.
    }
    // Opening the tile attached the debugger; drop it (and Chrome's bar) when the run isn't pressing Generate.
    if (state?.status !== 'running') await detachFlowDebugger(tabId);
    lastDetailReturn = Date.now();
    inDetail = false;
  }
}

// ---- Matching results ----------------------------------------------------

/** The Flow tab reported its tiles. Ignored while VidFlow has it on a picture's detail page. */
export async function handleTiles(cards: FlowResultCard[]): Promise<void> {
  await ready;
  if (inDetail) return;
  // The page reports picture tiles only: for a clip run a report just says something changed, so look at the clips.
  if (isClipRun(state)) return void pullTiles();
  latestReport = { id: latestReport.id + 1, at: Date.now(), cards };
  void processTiles();
}

async function processTiles(): Promise<void> {
  if (matching) {
    matchAgain = true;
    return;
  }
  matching = true;
  try {
    do {
      matchAgain = false;
      await withTab(matchOnce);
    } while (matchAgain);
  } catch {
    // A failed pass is retried on the next tile report.
  } finally {
    matching = false;
  }
}

/**
 * Asks VidFlow's Flow tab for its tiles now and matches them, instead of waiting for the page to report: it only
 * reports changes, so results that finished while VidFlow was paused or asleep would otherwise never be seen.
 * A running run (re)opens its Flow window and project when needed; a paused one only looks at the tab it has.
 */
async function pullTiles(): Promise<void> {
  try {
    await ready;
    if (!state || !port || state.inFlight.length === 0) return;
    if (state.status !== 'running' && state.status !== 'paused') return;
    const p = port;
    const projectId = state.projectId;
    let tabId = (await savedFlowWindow())?.tabId;
    if (state.status === 'running') tabId = await ensureFlowTab();
    if (tabId === undefined) return;
    const id = tabId;
    await withTab(async () => {
      if (!stillCollecting(projectId)) return;
      const action = flowProjectAction(state?.flowProjectUrl, await tabUrl(id));
      if (action.kind === 'navigate') {
        if (!stillRunning(projectId)) return; // a paused run doesn't move the tab
        await chrome.tabs.update(id, { url: action.url });
        if (!(await waitForUrl(id, (u) => projectUrlOf(u) === action.url))) return;
      } else if (action.kind !== 'ok') return;
      latestReport = { id: latestReport.id + 1, at: Date.now(), cards: isClipRun(state) ? await runTiles(id) : await p.tiles(id) };
    });
    await processTiles();
  } catch {
    // The page reports its tiles itself as they change; this was only a head start.
  }
}

/**
 * Settles every in-flight scene the latest tiles complete. A picture is saved only after its detail prompt verifies.
 * Runs while paused too: a pause (the owner, a limit, a page that needs the owner) only stops sending.
 */
async function matchOnce(): Promise<void> {
  for (let round = 0; round < 100; round++) {
    if (!state || (state.status !== 'running' && state.status !== 'paused') || !port) return;
    const run = state;
    const project = await getProject(run.projectId);
    const tabId = (await savedFlowWindow())?.tabId;
    if (!project || tabId === undefined) return;
    const submissions: Submission[] = run.inFlight.flatMap((sceneId) => {
      const s = run.sceneStates[sceneId];
      return s?.status === 'submitted' && s.submission
        ? [{ sceneId, prompt: s.submission.prompt, seq: s.submission.seq, submittedAt: s.submission.at }]
        : [];
    });
    if (submissions.length === 0) return;
    // Skipped submissions keep their place in the order (their tiles never shift onto later scenes); never saved.
    // A skipped submission Flow hasn't drawn within a scene's deadline never will: it stops holding a place.
    const now = Date.now();
    const skipped: Submission[] = liveSkipped(run, now).map((x) => ({
      sceneId: `${SKIPPED_SLOT}${x.seq}`,
      prompt: x.prompt,
      seq: x.seq,
      submittedAt: x.at,
    }));
    const report = latestReport;
    const cards = report.cards.filter(notReference(run));
    const details = run.detailPrompts ?? {};
    const matches = matchResults([...submissions, ...skipped], cards, claimedKeys(run), outputsOf(run, project), details).filter(
      (m) => !m.sceneId.startsWith(SKIPPED_SLOT),
    );
    // A report taken while the grid may still be redrawing (just back from a detail page) can't make VidFlow give up.
    const settled = report.at - lastDetailReturn >= SETTLE_MS;
    const unconfirmedNow = new Set(matches.filter((m) => m.kind === 'unconfirmed').map((m) => m.sceneId));
    if (settled) for (const { sceneId } of submissions) if (!unconfirmedNow.has(sceneId)) unconfirmedStreak.delete(sceneId);

    let changed = false;
    for (const m of matches) {
      if (m.kind === 'refused') await dispatch({ type: 'refused', sceneId: m.sceneId, message: m.message });
      else if (m.kind === 'unconfirmed') {
        // Only give up when the same holds in GIVE_UP_AFTER settled reports in a row (or at the scene's deadline).
        const streak = unconfirmedStreak.get(m.sceneId) ?? { count: 0, reportId: -1 };
        if (settled && streak.reportId !== report.id) unconfirmedStreak.set(m.sceneId, { count: streak.count + 1, reportId: report.id });
        if ((unconfirmedStreak.get(m.sceneId)?.count ?? 0) < GIVE_UP_AFTER) continue;
        unconfirmedStreak.delete(m.sceneId);
        await dispatch({ type: 'failed', sceneId: m.sceneId, message: isClipRun(run) ? clipFailure(m.sceneId, CLIP_UNCONFIRMED) : UNCONFIRMED_MESSAGE });
      } else if (isClipRun(run)) {
        // One clip per slide: its page is opened to check its prompt (once) and to take its file, then it is saved.
        if ((await collectClip(tabId, project, run, m.sceneId, m.cardKeys[0]!, report.id)) === 'wait') return;
        changed = true;
        break; // match again with what the page showed
      } else {
        const [key] = unverifiedKeys(m, details);
        if (key !== undefined) {
          // Check it in Flow's detail view, then match again with what that showed.
          note(project, m.sceneId, `Checking picture ${m.cardKeys.indexOf(key) + 1} of ${m.cardKeys.length} matches its prompt`, 'tile', key);
          const detail = await detailOf(tabId, run.projectId, key, report.id);
          if (detail === null || detail === 'unread') return; // stopped, or try again on the next tile report
          if (detail === '') await dispatch({ type: 'failed', sceneId: m.sceneId, message: UNCONFIRMED_MESSAGE });
          changed = true;
          break;
        }
        await savePictures(project, m.sceneId, m.cardKeys, cards);
      }
      changed = true;
    }
    if (!changed) return;
  }
}

/** Only Flow's own picture host, over https, is fetched (the URL comes from the page). */
function isFlowPictureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'flow-content.google';
  } catch {
    return false;
  }
}

/**
 * Fetches each verified card's picture (signed URL, extension-only) and stores it as scene-NN-option-K, or for the
 * model sheet as hero-sheet-option-K.
 */
async function savePictures(project: Project, sceneId: string, cardKeys: string[], cards: FlowResultCard[]): Promise<void> {
  const sheet = sceneId === HERO_SHEET_ID && isHeroSheetRun(state);
  const nn = String(project.scenes.findIndex((s) => s.id === sceneId) + 1).padStart(2, '0');
  const base = sheet ? HERO_SHEET_ID : `scene-${nn}`;
  // Skipped or stopped meanwhile: nothing is written (its files would replace the scene's pictures).
  const wanted = () => state?.projectId === project.id && state.inFlight.includes(sceneId);
  // The reference uploaded into this run's Flow project was attached to every prompt sent in it.
  const withHero = !sheet && !!state?.reference && state.reference.flowProjectUrl === state.flowProjectUrl;
  // Media id → the signed Flow address it came from: auto-save downloads from there (a data: URL can't carry 4 MB).
  const urls: Record<string, string> = {};
  try {
    const mediaIds: string[] = [];
    for (const [i, key] of cardKeys.entries()) {
      const url = cards.find((c) => c.key === key)?.imageUrl;
      if (!url) throw new Error('no picture address');
      if (!isFlowPictureUrl(url)) {
        await dispatch({ type: 'failed', sceneId, message: UNTRUSTED_PICTURE_MESSAGE });
        return;
      }
      if (!wanted()) return;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`picture fetch ${res.status}`);
      const blob = await res.blob();
      if (!wanted()) return;
      const mediaId = await getMediaStore().put(project.id, `${base}-option-${i + 1}`, blob);
      mediaIds.push(mediaId);
      urls[mediaId] = url;
    }
    // Made again under the same media ids: the old files on the Mac are not these pictures.
    if (!sheet) await enqueue(() => forgetDownloads(project.id, mediaIds)).catch((err) => console.warn('[VidFlow] download record failed', err));
    await dispatch({ type: 'pictures', sceneId, mediaIds, cardKeys, withHero });
  } catch {
    await dispatch({ type: 'failed', sceneId, message: SAVE_FAILED_MESSAGE });
    return;
  }
  // Auto-save (when its switch is on): never awaited, never fails the run; its project write takes the queue's turn.
  if (!sheet) void autoSaveScene(project.id, sceneId, { urls, writer: (write) => enqueue(write) });
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    await ready;
    for (;;) {
      if (!state || state.status !== 'running') return;
      const projectId = state.projectId;
      const project = await getProject(projectId);
      if (!project) return void (await pauseWith('This project is no longer in VidFlow.'));
      const sheet = isHeroSheetRun(state);
      const order = sheet ? [HERO_SHEET_ID] : project.scenes.map((s) => s.id);
      const sceneId = nextSceneToSubmit(state, order, MAX_IN_FLIGHT);
      if (!sceneId) return;
      const scene = sheet ? null : project.scenes.find((s) => s.id === sceneId);
      if (!sheet && !scene) return void (await pauseWith(`VidFlow couldn't find ${sceneId} in this project.`));
      if (!port) return void (await pauseWith("VidFlow isn't connected to Flow yet. Open VidFlow again, then press Resume."));

      let tabId: number;
      try {
        tabId = await ensureFlowTab();
      } catch {
        return void (await pauseWith("VidFlow couldn't open its Flow window. Check Chrome, then press Resume."));
      }
      const job = isClipRun(state) ? state.clips?.[sceneId] : undefined;
      const prompt = job
        ? job.prompt
        : scene
          ? buildImagePrompt(scene, projectStyle(project), project.character)
          : buildModelSheetPrompt(project.character ?? { description: '' }, projectStyle(project));
      if ((await withTab(() => submitScene(tabId, project, sceneId, prompt))) === 'stop') return;
      await sleep(paceMs());
    }
  } finally {
    pumping = false;
  }
}

// ---- Public API ----------------------------------------------------------

/** Which run is about to start: a model sheet only needs the account, the page and the prompt bar. */
export type StartChecksKind = 'scenes' | 'sheet' | 'clips';
/** Runs the Checks before a start: the failing check's plain fix, or null to go ahead. */
export type StartChecks = (projectId: string, kind: StartChecksKind) => Promise<string | null>;
let startChecks: StartChecks | null = null;

/**
 * The background sets this to the Checks (src/runs/checks.ts) so every Start runs them first. Unset (tests, the e2e
 * build), a start goes straight ahead as before.
 */
export function setStartChecks(fn: StartChecks | null): void {
  startChecks = fn;
}

export const TESTING_PROMPT_MESSAGE = 'VidFlow is testing one prompt in Flow. Wait a few seconds, then press Start again.';
/** Test one prompt pressed again while it is still testing (never "press Start": the owner pressed Test one prompt). */
export const ALREADY_TESTING_MESSAGE = 'VidFlow is already testing one prompt. Wait a few seconds, then try again.';
let testingPrompt = false;
/** Starts in progress (from the press until the run is committed or refused): Test one prompt waits for them. */
let starting = 0;

/** Holds `starting` while a Start runs its checks and commits, so Test one prompt can't use the tab meanwhile. */
async function asStart<T>(fn: () => Promise<T>): Promise<T> {
  starting++;
  try {
    return await fn();
  } finally {
    starting--;
  }
}

/** Why Test one prompt can't use VidFlow's Flow tab now (a start under way, a running or paused run), or null. */
export function testPromptRefusal(): string | null {
  return starting > 0 ? TEST_WHILE_STARTING_MESSAGE : refusalForStatus(state?.status);
}

/** Test one prompt holds this while it uses the Flow tab: no run may start meanwhile (it would type over the test). */
export async function whileTestingPrompt<T>(fn: () => Promise<T>): Promise<T> {
  if (testingPrompt) throw new RunBlockedError(ALREADY_TESTING_MESSAGE);
  if (starting > 0) throw new RunBlockedError(TEST_WHILE_STARTING_MESSAGE);
  testingPrompt = true;
  try {
    return await fn();
  } finally {
    testingPrompt = false;
  }
}

/** Throws RunBlockedError with the failing check's fix; nothing is started or committed. */
async function passStartChecks(projectId: string, kind: StartChecksKind): Promise<void> {
  if (!startChecks) return;
  const problem = await startChecks(projectId, kind);
  if (problem) throw new RunBlockedError(problem);
}

/**
 * Test one prompt: puts VidFlow's Flow tab on a fresh Flow project (pressing Flow's own New project on its home page)
 * unless it is on one already. Never while a run is live, and never touches the run's state. Throws FlowBlockedError
 * (wrong account, a notice) or Error with a plain message.
 */
export async function openTestFlowProject(tabId: number): Promise<void> {
  await ready;
  const refused = testPromptRefusal();
  if (refused) throw new RunBlockedError(refused);
  if (!port) throw new Error(NO_PORT_MESSAGE);
  await withTab(async () => {
    if (projectUrlOf(await tabUrl(tabId))) return;
    if (!isFlowHome(await tabUrl(tabId))) {
      await chrome.tabs.update(tabId, { url: FLOW_URL });
      await waitForUrl(tabId, isFlowHome);
    }
    const at = await port!.findNewProject(tabId, 'Test'); // its refusals say "try again", never "press Start"
    const now = testPromptRefusal();
    if (now) throw new RunBlockedError(now);
    try {
      await pressIn(tabId, at.x, at.y);
    } finally {
      await detachFlowDebugger(tabId); // no run is pressing Generate: drop Chrome's debugging bar at once
    }
    if (!(await waitForUrl(tabId, (u) => projectUrlOf(u) !== null))) throw new Error(TEST_NO_PROJECT_MESSAGE);
  });
}

const TEST_NO_PROJECT_MESSAGE = "VidFlow pressed New project but Flow didn't open one. Check the Flow window, then try again.";
const NO_PORT_MESSAGE = "VidFlow can't reach the Flow page yet. Try again in a moment.";

/** Why a run for `projectId` can't start now (another project's run is running, or paused with work left), or null. */
async function startBlocker(projectId: string): Promise<string | null> {
  if (state && isHeroSheetRun(state) && isLive(state)) return sheetBlock(state);
  if (state && isClipRun(state) && isLive(state)) return clipsBlock(state);
  if (!state || state.projectId === projectId) return null;
  if (state.status === 'running') return BUSY_MESSAGE;
  const unfinished = Object.values(state.sceneStates).some((s) => s.status === 'pending' || s.status === 'submitted');
  if (state.status === 'paused' && unfinished) {
    const name = (await getProject(state.projectId))?.name ?? 'Another video';
    return `\u201c${name}\u201d is paused with pictures still to make. Resume it or stop it first, then start this one.`;
  }
  return null;
}

export function startRun(projectId: string, retrySceneId?: string): Promise<void> {
  return asStart(() => startRunNow(projectId, retrySceneId));
}

async function startRunNow(projectId: string, retrySceneId?: string): Promise<void> {
  await ready;
  postPressNotices.clear();
  waitingNotices = 0;
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
  if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
  // The Checks run first (spec §19), but only for a start that would happen: a busy refusal or a run already going
  // never touches Flow. They talk to Flow, so they run outside the queue; the queue re-checks the blockers.
  if (!(state?.projectId === projectId && state.status === 'running')) {
    const blocked = await startBlocker(projectId);
    if (blocked) throw new RunBlockedError(blocked);
    await passStartChecks(projectId, 'scenes');
  }
  await enqueue(async () => {
    // Test one prompt may have begun while the checks talked to Flow: it has the tab, so this start waits for it.
    if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
    const blocked = await startBlocker(projectId);
    if (blocked) throw new RunBlockedError(blocked);
    // Already making this project's pictures: nothing to do (a fresh start would re-send scenes in Flow).
    if (state?.projectId === projectId && state.status === 'running') return;
    let next = initRun(project);
    if (retrySceneId) {
      // ▶ Run / Try again with no run of this video: a run of just that scene (spec §19 settled detail 2).
      const only = next.sceneStates[retrySceneId];
      if (!only) throw new Error(`VidFlow couldn't find ${retrySceneId} in this project.`);
      next = reduceRun({ ...next, sceneStates: { [retrySceneId]: only } }, { type: 'retry', sceneId: retrySceneId });
    }
    await commit(reduceRun(next, { type: 'start' }));
  });
  void pump();
}

/** Stop: the run ends (idle) without deleting any pictures; Start carries on later from the first unfinished scene. */
export const stopRun = () => dispatch({ type: 'stop' });

/** The project's scenes were replaced: a finished (or stopped) run for it no longer describes them, so forget it. */
export async function discardFinishedRun(projectId: string): Promise<void> {
  await ready;
  await enqueue(async () => {
    if (!state || state.projectId !== projectId) return;
    if (state.status === 'running' || state.status === 'paused') return;
    state = null;
    await chrome.storage.local.remove(RUN_KEY);
  });
}

/** Try again on one refused or failed scene: re-queue it in this project's run, or start a run for it. */
export async function retryScene(projectId: string, sceneId: string): Promise<void> {
  await ready;
  // Only a pictures run takes the scene back; otherwise (model sheet, clips) it is a new pictures run for it.
  if (state?.projectId === projectId && state.status !== 'idle' && isSceneRun(state)) {
    // Paused with nothing left to make (not live): ▶ Run is offered, and the scene must then be made, so it resumes.
    const resumeAfter = state.status === 'paused' && !isLive(state);
    if (!(sceneId in state.sceneStates)) {
      // Not one of this run's scenes (▶ Run on a scene the run left out): it joins the run as it is saved.
      const project = await getProject(projectId);
      const scene = project?.scenes.some((s) => s.id === sceneId) ? project.sceneStates[sceneId] : null;
      if (scene === null) throw new Error(`VidFlow couldn't find ${sceneId} in this project.`);
      await enqueue(async () => {
        if (!state || state.projectId !== projectId || sceneId in state.sceneStates) return;
        const joined = scene && scene.status !== 'submitted' ? { ...scene } : { sceneId, status: 'pending' as const, pictureIds: scene?.pictureIds ?? [] };
        const next = { ...state, sceneStates: { ...state.sceneStates, [sceneId]: joined } };
        // A finished run carries on with it; a pending scene that joins needs the run going too.
        await commit(joined.status === 'pending' && next.status === 'finished' ? { ...next, status: 'running' } : next);
      });
    }
    await dispatch({ type: 'retry', sceneId });
    if (resumeAfter && state?.status === 'paused' && isLive(state)) await resumeRun();
    return;
  }
  return startRun(projectId, sceneId); // refused while a model sheet is being made
}

/**
 * Skip (spec §19): the scene VidFlow is working on now ends as failed "Skipped by you" and the run moves on. "Now" is
 * the scene the step names (what the panel shows), else the one being sent, else the newest in Flow, else the next to
 * send. If it was in Flow already, its pictures are never saved (see the run's skippedPrompts). Nothing live: no-op.
 * Paused about one slide (pauseSceneId): that slide, never another; the run stays paused until Resume.
 */
export async function skipCurrent(): Promise<void> {
  await ready;
  if (!state || !isLive(state) || isHeroSheetRun(state)) return;
  const step = ((await chrome.storage.local.get(STEP_KEY))[STEP_KEY] ?? null) as Step | null;
  const project = await getProject(state.projectId);
  await enqueue(async () => {
    const run = state;
    if (!run || !isLive(run) || isHeroSheetRun(run)) return;
    const open = (id: string | null | undefined): id is string =>
      !!id && (run.sceneStates[id]?.status === 'pending' || run.sceneStates[id]?.status === 'submitted');
    const newest = [...run.inFlight].sort((a, b) => (run.sceneStates[b]?.submission?.seq ?? 0) - (run.sceneStates[a]?.submission?.seq ?? 0))[0];
    const next = (project?.scenes ?? []).map((s) => s.id).find((id) => run.sceneStates[id]?.status === 'pending');
    // Paused about one slide (a clip VidFlow couldn't tell Flow started): Skip means that slide, and only it.
    const about = run.status === 'paused' ? run.pauseSceneId : undefined;
    const target = about !== undefined ? [about].find(open) : [step?.projectId === run.projectId ? step.sceneId : null, submitting, newest, next].find(open);
    if (!target) return;
    await commit(reduceRun(run, { type: 'skip', sceneId: target }));
  });
  void pump();
  void processTiles();
}

/**
 * Makes the hero's model sheet in Flow: one prompt (front, side, back, 3 expressions) in a fresh Flow project, with
 * the project's outputs per prompt, saved as hero-sheet-option-K on project.heroSheet. It is its own run, so it
 * refuses (BUSY_MESSAGE) while any run is live; pressing it again after it finished (or was refused) makes it again.
 */
export function startHeroSheetRun(projectId: string): Promise<void> {
  return asStart(() => startHeroSheetRunNow(projectId));
}

async function startHeroSheetRunNow(projectId: string): Promise<void> {
  await ready;
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
  if (!project.character?.description.trim()) throw new Error(HERO_SHEET_NEEDS_HERO);
  if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
  if (!(state && isLive(state))) await passStartChecks(projectId, 'sheet'); // a live run refuses below, without Flow
  await enqueue(async () => {
    if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
    if (state && isLive(state)) {
      if (isHeroSheetRun(state)) {
        if (state.projectId === projectId && state.status === 'running') return; // already at it
        throw new RunBlockedError(state.status === 'paused' ? HERO_SHEET_PAUSED_MESSAGE : BUSY_MESSAGE);
      }
      if (isClipRun(state)) throw new RunBlockedError(clipsBlock(state));
      throw new RunBlockedError(state.projectId === projectId ? HERO_SHEET_SCENES_BUSY : BUSY_MESSAGE);
    }
    await commit(reduceRun(initHeroSheetRun(project), { type: 'start' }));
  });
  void pump();
}

/**
 * Make clips (spec §20): one clip per slide that needs one (scenesToClip, fixed now) from its chosen picture, in a
 * fresh Flow project, stopping before a clip that would pass `limit` credits or Flow's balance. Its own run: refused
 * while any run is live, and for a 1:1 video. The Checks run first, as for every start.
 */
export function startClipRun(projectId: string, limit: number): Promise<void> {
  return asStart(() => startClipRunNow(projectId, limit));
}

async function startClipRunNow(projectId: string, limit: number): Promise<void> {
  await ready;
  postPressNotices.clear();
  waitingNotices = 0;
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
  if (project.aspect !== '16:9' && project.aspect !== '9:16') throw new Error(CLIP_ASPECT_MESSAGE);
  if (!Number.isFinite(limit) || limit < 0) throw new Error(CLIP_LIMIT_MESSAGE);
  if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
  const refusal = (run: RunState | null): string | null => {
    if (!run || !isLive(run)) return null;
    if (isHeroSheetRun(run)) return sheetBlock(run);
    if (isClipRun(run)) return run.projectId === projectId ? clipsBlock(run) : BUSY_MESSAGE;
    return run.projectId === projectId ? CLIPS_SCENES_BUSY : BUSY_MESSAGE;
  };
  const busy = refusal(state);
  if (busy) throw new RunBlockedError(busy);
  if (scenesToClip(project, project.sceneStates).length === 0) throw new Error(NOTHING_TO_CLIP_MESSAGE);
  await passStartChecks(projectId, 'clips');
  await enqueue(async () => {
    if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
    const blocked = refusal(state);
    if (blocked) throw new RunBlockedError(blocked);
    // The slides, pictures and lengths as they are now (an edit meanwhile doesn't change what this run makes).
    const fresh = (await getProject(projectId)) ?? project;
    const ids = scenesToClip(fresh, fresh.sceneStates);
    if (ids.length === 0) throw new Error(NOTHING_TO_CLIP_MESSAGE);
    await commit(reduceRun(initClipRun(fresh, ids, limit), { type: 'start' }));
  });
  void pump();
  void clipPoll();
}

/**
 * A line in the current run's activity about VidFlow's Flow tab ("Closed Flow's announcement", a panel Flow left
 * open). Nothing when there is no run. Never throws.
 */
export function noteFlowTab(text: string): void {
  const projectId = state?.projectId;
  if (!projectId) return;
  logActivity({ at: Date.now(), projectId, sceneId: null, text }).catch((err) => console.warn('[VidFlow] activity write failed', err));
}

/**
 * The owner chose one of a scene's pictures. While this project has a run (live or finished) the run's state takes it,
 * so the choice is saved with the project and survives every later broadcast; otherwise the stored project takes it
 * (and nothing is broadcast: the studio re-reads the project). Either way the activity log says "Swapped to picture K".
 */
export async function chooseScenePicture(projectId: string, sceneId: string, pictureId: string): Promise<void> {
  await ready;
  const option = await enqueue(async () => {
    // Only a pictures run holds the scenes' pictures; a clip run's states are its clips' (the choice goes to the project).
    const inRun = state?.projectId === projectId && isSceneRun(state) ? state.sceneStates[sceneId] : undefined;
    if (state && inRun) {
      if (!inRun.pictureIds.includes(pictureId)) throw new Error(NOT_THIS_SCENES_PICTURE);
      await commit(reduceRun(state, { type: 'choose', sceneId, pictureId }));
      return inRun.pictureIds.indexOf(pictureId) + 1;
    }
    let option = 0;
    await updateProject(projectId, (project) => {
      const scene = project.sceneStates[sceneId];
      if (!scene || !scene.pictureIds.includes(pictureId)) return;
      project.sceneStates = { ...project.sceneStates, [sceneId]: { ...scene, chosenPictureId: pictureId, choiceSource: 'owner' } };
      option = scene.pictureIds.indexOf(pictureId) + 1;
    });
    if (!option) throw new Error(NOT_THIS_SCENES_PICTURE);
    return option;
  });
  // Written before the studio hears back, so its activity list shows the line with the swap. A log failure never
  // undoes the choice.
  await logActivity({ at: Date.now(), projectId, sceneId, text: `Swapped to picture ${option}` }).catch((err) =>
    console.warn('[VidFlow] activity write failed', err),
  );
}

export const pauseRun = () => dispatch({ type: 'pause' });
export async function resumeRun(): Promise<void> {
  waitingNotices = 0;
  await dispatch({ type: 'resume' });
  void pullTiles();
}

/**
 * The background calls this when the Flow helper reports something. Waits for state to load; never drops scene events.
 * Page-level events (limit, needs-owner) only matter to a running run: they must not turn a finished run into a paused one.
 */
export async function handleFlowEvent(event: RunEvent): Promise<void> {
  await ready;
  if ((event.type === 'limit' || event.type === 'needsOwner') && state?.status !== 'running') return;
  await dispatch(event);
}

/**
 * Flow's usage notice appeared in VidFlow's own Flow tab while the run waits (the Flow helper sends this only with
 * "Accept Flow's notices automatically" on). Accepted like pastNotice does it, and logged, at most MAX_WAITING_NOTICES
 * times between prompts Flow takes; otherwise (switch off meanwhile, couldn't accept, too many) the run pauses with the
 * usage-policy message. A notice already gone (the run's own step accepted it) changes nothing. Billing never comes here.
 */
export async function handleFlowNotice(tabId: number): Promise<void> {
  await ready;
  if (state?.status !== 'running' || !port) return;
  const projectId = state.projectId;
  const pause = () => dispatch({ type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage(PUMP_VERB) });
  // Takes the tab's turn: a step that is typing finds and accepts the notice itself first.
  await withTab(async () => {
    if (!stillRunning(projectId)) return;
    if (!(await getAcceptNotices()) || waitingNotices >= MAX_WAITING_NOTICES) return pause();
    const accepted = await port!.acceptNotice(tabId).catch(() => null);
    if (accepted === 'gone' || accepted === null) return; // nothing there now, or the page reloaded after accepting
    if (accepted === false) return pause();
    waitingNotices++;
    logAcceptedNotice(projectId, null);
  });
}

/** What the pill in a Flow tab should show: only VidFlow's own Flow tab, only while a run is going. */
export async function pillFor(tabId: number | undefined): Promise<LiveView | null> {
  await ready;
  if (!(await isFlowTab(tabId)) || !state) return null;
  const run = state;
  const step = ((await chrome.storage.local.get(STEP_KEY))[STEP_KEY] ?? null) as Step | null;
  const project = (await getProject(run.projectId)) ?? null;
  return liveView(run, step, project);
}

async function load(): Promise<void> {
  const saved = (await chrome.storage.local.get(RUN_KEY))[RUN_KEY] as RunState | undefined;
  // storage.session survives a service-worker sleep but not a browser restart or extension reload.
  const alive = (await chrome.storage.session.get(SESSION_MARKER))[SESSION_MARKER];
  const freshBrowser = !alive;
  await chrome.storage.session.set({ [SESSION_MARKER]: true });
  if (freshBrowser) await forgetFlowWindow();
  if (!saved) return;
  state = saved;
  if (freshBrowser) {
    await enqueue(async () => {
      let next = reduceRun(saved, { type: 'restore' });
      if (next.status === 'paused' && typeof next.resumeAt === 'number' && next.resumeAt <= Date.now()) {
        next = reduceRun(next, { type: 'resume' });
      }
      await commit(next);
    });
  } else if (saved.status === 'running' && (await getKeepAwake())) {
    chrome.power.requestKeepAwake('system');
  }
}

/**
 * A scene's 10 minutes in Flow are up. Decided inside the queue, against the state then: only a scene still in Flow
 * ('submitted') of a running run fails; one that was saved, refused or failed meanwhile, or a paused run, is left alone.
 */
async function handleDeadline(sceneId: string): Promise<void> {
  await ready;
  await enqueue(async () => {
    if (!state || state.status !== 'running' || !state.inFlight.includes(sceneId)) return;
    if (state.sceneStates[sceneId]?.status !== 'submitted') return;
    if (isClipRun(state) && clipBeingChecked(state, sceneId)) {
      // Flow finished a clip that may be this slide's and VidFlow is checking it: the deadline waits a little.
      await chrome.alarms.create(DEADLINE_PREFIX + sceneId, { delayInMinutes: CHECK_GRACE_MINUTES });
      return;
    }
    await commit(
      reduceRun(state, {
        type: 'failed',
        sceneId,
        // A scene VidFlow couldn't match consistently says so, rather than blaming Flow's speed.
        message: isClipRun(state)
          ? clipFailure(sceneId, unconfirmedStreak.has(sceneId) ? CLIP_UNCONFIRMED : CLIP_UNFINISHED)
          : unconfirmedStreak.has(sceneId)
            ? UNCONFIRMED_MESSAGE
            : "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
      }),
    );
  });
  void pump();
  void processTiles();
}

/** How long a clip run's deadline waits again while a finished clip that may be the slide's is being checked. */
const CHECK_GRACE_MINUTES = 2;

/**
 * True while a finished clip that may be this slide's is waiting to be checked or saved: it was matched to the slide
 * (submission.clipKey), or the latest grid has an unclaimed finished clip whose prompt is unknown or is the slide's.
 */
function clipBeingChecked(run: RunState, sceneId: string): boolean {
  const sub = run.sceneStates[sceneId]?.submission;
  if (!sub) return false;
  if (sub.clipKey && !run.clipClaims?.[sub.clipKey]) {
    // A tile whose page showed another slide's prompt is not being checked for this one.
    const checked = run.detailPrompts?.[sub.clipKey];
    if (checked === undefined || verifyMatch(sub.prompt, checked)) return true;
  }
  return latestReport.cards.some((c) => {
    if (!isFinished(c) || !c.key.startsWith('poster:') || run.clipClaims?.[c.key]) return false;
    const detail = run.detailPrompts?.[c.key];
    return detail === undefined || verifyMatch(sub.prompt, detail);
  });
}

/** Register listeners synchronously from the background entry, once. */
export function registerCoordinator(): void {
  ready = load().catch(() => undefined);
  // Flow's own browser download of a clip VidFlow fetched itself is cancelled and erased (never any other download).
  if (chrome.downloads?.onCreated) {
    flowDownloads = createFlowDownloadGuard(chrome.downloads as never, chrome.runtime.id);
    const guard = flowDownloads;
    chrome.downloads.onCreated.addListener((item) => void guard.onCreated(item).catch(() => undefined));
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESUME_ALARM) void resumeRun();
    else if (alarm.name.startsWith(DEADLINE_PREFIX)) void handleDeadline(alarm.name.slice(DEADLINE_PREFIX.length));
  });
  chrome.windows.onRemoved.addListener(async (windowId) => {
    const saved = await savedFlowWindow();
    if (saved?.windowId !== windowId) return;
    await forgetFlowWindow();
    // Never reopened behind the owner's back: the run pauses and says so; Resume opens a new window.
    await ready;
    if (state?.status === 'running') await pauseWith(WINDOW_CLOSED_MESSAGE);
  });
  chrome.runtime.onStartup.addListener(() => void forgetFlowWindow());
  // The keep-awake switch takes effect at once on a running run.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(KEEP_AWAKE_KEY in changes) || state?.status !== 'running') return;
    if (changes[KEEP_AWAKE_KEY]!.newValue === false) chrome.power.releaseKeepAwake();
    else chrome.power.requestKeepAwake('system');
  });
  void ready.then(() => {
    void pump();
    void pullTiles(); // results that finished while the worker slept
    void clipPoll();
  });
}

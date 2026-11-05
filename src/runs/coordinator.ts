/// <reference types="chrome" />
import { policyDialogMessage, type FlowResultCard, type StartVerb } from '../flow/driver';
import { matchResults, unverifiedKeys, UNCONFIRMED_MESSAGE, verifyMatch, type Submission } from '../flow/match';
import { FlowBlockedError, REFERENCE_ATTACH_MESSAGE, type Point, type SubmitOptions } from '../flow/messages';
import { isFlowUrl } from '../flow/hosts';
import { flowProjectAction, isFlowHome, projectUrlOf } from '../flow/project';
import { liveView } from '../flow/live';
import type { LiveView } from '../flow/messages';
import { detachFlowDebugger } from '../flow/press';
import { buildImagePrompt, buildModelSheetPrompt } from '../prompts/build';
import { customStyle, STYLE_PRESETS } from '../prompts/styles';
import { logActivity, setStep, STEP_KEY, type Step, type StepTarget } from './activity';
import { getMediaStore, getProject, saveProject, type Project, type SceneState } from '../store/projects';
import { getAcceptNotices, getKeepAwake, KEEP_AWAKE_KEY } from '../settings';
import {
  HERO_SHEET_ID,
  initHeroSheetRun,
  initRun,
  isHeroSheetRun,
  isLive,
  nextSceneToSubmit,
  normaliseEvent,
  NOT_THIS_SCENES_PICTURE,
  reduceRun,
  runSummary,
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
   * didn't start and Flow's usage-policy / rights notice is showing instead.
   */
  confirmStarted(tabId: number): Promise<boolean | 'notice'>;
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
   * False when it couldn't; null when the page gave no answer (e.g. it reloaded after accepting).
   */
  acceptNotice(tabId: number): Promise<boolean | null>;
}

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

let port: FlowPort | null = null;
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

export function setFlowPort(p: FlowPort): void {
  port = p;
  void pump();
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
  for (const [sceneId, now] of Object.entries(next.sceneStates)) {
    const before = prev?.sceneStates[sceneId]?.status;
    if (before === now.status) continue;
    if (now.status === 'submitted') note(project, sceneId, 'Sent to Flow');
    else if (now.status === 'done') note(project, sceneId, `✓ Saved ${pictures(now.pictureIds.length)}`);
    else if (now.status === 'refused' || now.status === 'failed') note(project, sceneId, now.message ?? 'Needs a look');
  }
  if (prev?.status === next.status) return;
  if (next.status === 'paused') {
    note(project, null, next.pauseReason && next.pauseReason !== USER_PAUSE_REASON ? `Paused: ${next.pauseReason}` : 'Paused by you');
  } else if (next.status === 'running' && prev?.status === 'paused') note(project, null, 'Resumed');
  else if (next.status === 'finished') {
    const { done } = runSummary(next);
    if (isHeroSheetRun(next)) note(project, null, done > 0 ? 'Finished: the model sheet is ready' : 'Finished: the model sheet needs a look');
    else note(project, null, `Finished: pictures ready for ${done} of ${Object.keys(next.sceneStates).length} scenes`);
  }
}

/** What Flow was (or will be) asked for: a sheet run keeps the outputs and shape it started with. */
const outputsOf = (run: RunState | null, project: Project) => run?.sheet?.outputs ?? project.outputsPerPrompt;
const aspectOf = (run: RunState | null, project: Project) => run?.sheet?.aspect ?? project.aspect;

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

  // Re-read the project so edits made in Studio meanwhile are not overwritten; only sceneStates (or, for a model
  // sheet run, heroSheet) is ours. The sheet never goes into sceneStates: it isn't a scene.
  const project = await getProject(next.projectId);
  if (project) {
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
    } else project.sceneStates = { ...project.sceneStates, ...next.sceneStates };
    await saveProject(project);
    noteChanges(prev, next, project);
  }
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
}

function pauseWith(message: string): Promise<void> {
  return dispatch({ type: 'needsOwner', reason: 'page-not-recognised', message });
}

// ---- Submitting ----------------------------------------------------------

/** True while the run that the pump is working for is still running. Checked right before every Generate press. */
function stillRunning(projectId: string): boolean {
  return state?.status === 'running' && state.projectId === projectId;
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
    if (accepted) logAcceptedNotice(projectId, sceneId);
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
const oldestFirst = (cards: FlowResultCard[]) => [...cards].sort((a, b) => b.domIndex - a.domIndex);

/** Flow card keys already saved for a scene, or the hero reference's own tile; never matched to a scene. */
function claimedKeys(s: RunState): Set<string> {
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
  // The model sheet is how a reference is made: its run never uploads or attaches one, even if the hero has one.
  if (isHeroSheetRun(state)) return null;
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

/**
 * Sends one scene to Flow. Holds the tab. 'stop' ends this pump round (paused, stopped, or blocked); the scene stays
 * pending unless Flow confirmed the start.
 */
async function submitScene(tabId: number, project: Project, sceneId: string, prompt: string): Promise<'stop' | 'next'> {
  const projectId = project.id;
  try {
    if (!(await ensureFlowProject(tabId, projectId, () => note(project, null, 'Opened a new Flow project', 'project')))) return 'stop'; // stopped meanwhile; scene stays pending
    const reference = await ensureReference(tabId, project);
    if (!stillRunning(projectId)) return 'stop';
    const unconfirmed = state?.sceneStates[sceneId]?.unconfirmed;
    if (unconfirmed) {
      // A press whose start VidFlow didn't see may still have worked: look before pressing again (no surplus batch).
      const found = await findUnconfirmedStart(tabId, project, unconfirmed);
      if (found === null) return 'stop';
      if (found === 'wait') {
        // Look again after the pace pause, without pressing; but a tile that never finishes can't stall the run.
        if (unconfirmed.at === undefined) {
          await dispatch({ type: 'unconfirmed', sceneId, keysBefore: unconfirmed.keysBefore, prompt: unconfirmed.prompt });
        } else if (Date.now() - unconfirmed.at >= timings.unconfirmedWaitMs) {
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
    const n = outputsOf(state, project);
    const aspect = aspectOf(state, project);
    note(project, null, `Set Flow to Image · ${aspect} · ${pictures(n)}`, 'setting');
    note(project, sceneId, 'Typing the prompt', 'prompt');
    const at = await pastNotice(tabId, projectId, sceneId, () =>
      port!.prepare(tabId, sceneId, prompt, {
        aspect,
        outputs: n,
        verb: PUMP_VERB,
        ...(reference ? { reference: { name: reference } } : {}),
      }),
    );
    // Preparing can take ~40 s: if the owner paused (or the run ended) meanwhile, don't press; the scene stays pending.
    if (!stillRunning(projectId)) return 'stop';
    const keysBefore = (await port!.tiles(tabId)).filter(isFinished).map((c) => c.key);
    if (!stillRunning(projectId)) return 'stop';
    // Recorded before the press: if the worker is suspended before Flow's start is confirmed, the next pump looks for
    // this scene's tiles before pressing again (no surplus batch). `submitted` clears it.
    await dispatch({ type: 'unconfirmed', sceneId, keysBefore, prompt, at: Date.now() });
    if (!stillRunning(projectId)) return 'stop';
    note(project, sceneId, 'Pressing Generate', 'generate');
    await pressIn(tabId, at.x, at.y);
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
        return 'next';
      }
      postPressNotices.delete(sceneId); // after the owner's Resume, the next notice gets its one accept again
      await dispatch({ type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage(PUMP_VERB) });
      return 'stop';
    }
    postPressNotices.delete(sceneId); // started (or a different failure): the next notice is a new one
    if (!started) {
      await dispatch({ type: 'needsOwner', reason: 'page-not-recognised', message: NOT_STARTED_MESSAGE });
      return 'stop';
    }
    await dispatch({ type: 'submitted', sceneId, prompt, at: Date.now() });
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
    await dispatch({
      type: 'failed',
      sceneId,
      message: "VidFlow couldn't send this scene to Flow. Press Try again to send it again.",
    });
    return 'next';
  }
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
  const fresh = oldestFirst(await port!.tiles(tabId)).filter(
    (c) => !before.has(c.key) && !claimed.has(c.key) && notReference(state!)(c),
  );
  const samePromptInFlight = state.inFlight.filter((id) =>
    verifyMatch(u.prompt, state?.sceneStates[id]?.submission?.prompt ?? ''),
  ).length;
  const owedToOthers = samePromptInFlight * outputsOf(state, project);
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
async function detailOf(tabId: number, projectId: string, key: string, attempt: number): Promise<string | 'unread' | null> {
  const known = state?.detailPrompts?.[key];
  if (known !== undefined) return known;
  if (unreadCount.get(key)?.attempt === attempt) return 'unread'; // already tried on this report
  // While not running, the last strike is left for after Resume: a paused run doesn't keep opening a tile that won't
  // read (each visit changes the tiles, which would bring the next read) and never gives up on a card.
  if (state?.status !== 'running' && (unreadCount.get(key)?.count ?? 0) >= GIVE_UP_AFTER - 1) return null;
  const read = await readDetailFor(tabId, projectId, key);
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

/** readDetailFor didn't try (paused, tab off the project): unlike an unreadable detail, it doesn't count. */
const SKIPPED = Symbol('skipped');

/**
 * Opens a card's detail view in the Flow tab (trusted press on the tile), reads the full prompt, and goes back to the
 * run's project. null when anything doesn't line up; SKIPPED when a paused run's tab is off the project (it is never
 * moved then). Holds the tab.
 */
async function readDetailFor(tabId: number, projectId: string, key: string): Promise<string | null | typeof SKIPPED> {
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
    const at = await port.tilePoint(tabId, key);
    if (!stillCollecting(projectId)) return null;
    await pressIn(tabId, at.x, at.y);
    if (!(await waitForUrl(tabId, (u) => projectUrlOf(u) === flowUrl && /\/edit\//.test(u)))) return null;
    const { prompt, mediaId } = await port.readDetail(tabId);
    // Trust the prompt only when the page's one picture is this card; missing or different means unread.
    return mediaId === key ? prompt : null;
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
      latestReport = { id: latestReport.id + 1, at: Date.now(), cards: await p.tiles(id) };
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
    const report = latestReport;
    const cards = report.cards.filter(notReference(run));
    const details = run.detailPrompts ?? {};
    const matches = matchResults(submissions, cards, claimedKeys(run), outputsOf(run, project), details);
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
        await dispatch({ type: 'failed', sceneId: m.sceneId, message: UNCONFIRMED_MESSAGE });
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
  try {
    const mediaIds: string[] = [];
    for (const [i, key] of cardKeys.entries()) {
      const url = cards.find((c) => c.key === key)?.imageUrl;
      if (!url) throw new Error('no picture address');
      if (!isFlowPictureUrl(url)) {
        await dispatch({ type: 'failed', sceneId, message: UNTRUSTED_PICTURE_MESSAGE });
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`picture fetch ${res.status}`);
      mediaIds.push(await getMediaStore().put(project.id, `${base}-option-${i + 1}`, await res.blob()));
    }
    await dispatch({ type: 'pictures', sceneId, mediaIds, cardKeys });
  } catch {
    await dispatch({ type: 'failed', sceneId, message: SAVE_FAILED_MESSAGE });
  }
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
      const prompt = scene
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
export type StartChecksKind = 'scenes' | 'sheet';
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
let testingPrompt = false;

/** Test one prompt holds this while it uses the Flow tab: no run may start meanwhile (it would type over the test). */
export async function whileTestingPrompt<T>(fn: () => Promise<T>): Promise<T> {
  if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
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
  if (isLive(state)) throw new RunBlockedError(TEST_WHILE_RUNNING_MESSAGE);
  if (!port) throw new Error(NO_PORT_MESSAGE);
  await withTab(async () => {
    if (projectUrlOf(await tabUrl(tabId))) return;
    if (!isFlowHome(await tabUrl(tabId))) {
      await chrome.tabs.update(tabId, { url: FLOW_URL });
      await waitForUrl(tabId, isFlowHome);
    }
    const at = await port!.findNewProject(tabId, 'Start');
    if (isLive(state)) throw new RunBlockedError(TEST_WHILE_RUNNING_MESSAGE);
    try {
      await pressIn(tabId, at.x, at.y);
    } finally {
      await detachFlowDebugger(tabId); // no run is pressing Generate: drop Chrome's debugging bar at once
    }
    if (!(await waitForUrl(tabId, (u) => projectUrlOf(u) !== null))) throw new Error(TEST_NO_PROJECT_MESSAGE);
  });
}

export const TEST_WHILE_RUNNING_MESSAGE = 'VidFlow is making pictures right now. Test one prompt when the run has finished or stopped.';
const TEST_NO_PROJECT_MESSAGE = "VidFlow pressed New project but Flow didn't open one. Check the Flow window, then try again.";
const NO_PORT_MESSAGE = "VidFlow can't reach the Flow page yet. Try again in a moment.";

/** Why a run for `projectId` can't start now (another project's run is running, or paused with work left), or null. */
async function startBlocker(projectId: string): Promise<string | null> {
  if (state && isHeroSheetRun(state) && isLive(state)) return sheetBlock(state);
  if (!state || state.projectId === projectId) return null;
  if (state.status === 'running') return BUSY_MESSAGE;
  const unfinished = Object.values(state.sceneStates).some((s) => s.status === 'pending' || s.status === 'submitted');
  if (state.status === 'paused' && unfinished) {
    const name = (await getProject(state.projectId))?.name ?? 'Another video';
    return `\u201c${name}\u201d is paused with pictures still to make. Resume it or stop it first, then start this one.`;
  }
  return null;
}

export async function startRun(projectId: string, retrySceneId?: string): Promise<void> {
  await ready;
  postPressNotices.clear();
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
    const blocked = await startBlocker(projectId);
    if (blocked) throw new RunBlockedError(blocked);
    // Already making this project's pictures: nothing to do (a fresh start would re-send scenes in Flow).
    if (state?.projectId === projectId && state.status === 'running') return;
    let next = initRun(project);
    if (retrySceneId) next = reduceRun(next, { type: 'retry', sceneId: retrySceneId });
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
  if (state?.projectId === projectId && state.status !== 'idle' && !isHeroSheetRun(state)) return dispatch({ type: 'retry', sceneId });
  return startRun(projectId, sceneId); // refused while a model sheet is being made
}

/**
 * Makes the hero's model sheet in Flow: one prompt (front, side, back, 3 expressions) in a fresh Flow project, with
 * the project's outputs per prompt, saved as hero-sheet-option-K on project.heroSheet. It is its own run, so it
 * refuses (BUSY_MESSAGE) while any run is live; pressing it again after it finished (or was refused) makes it again.
 */
export async function startHeroSheetRun(projectId: string): Promise<void> {
  await ready;
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
  if (!project.character?.description.trim()) throw new Error(HERO_SHEET_NEEDS_HERO);
  if (testingPrompt) throw new RunBlockedError(TESTING_PROMPT_MESSAGE);
  if (!(state && isLive(state))) await passStartChecks(projectId, 'sheet'); // a live run refuses below, without Flow
  await enqueue(async () => {
    if (state && isLive(state)) {
      if (isHeroSheetRun(state)) {
        if (state.projectId === projectId && state.status === 'running') return; // already at it
        throw new RunBlockedError(state.status === 'paused' ? HERO_SHEET_PAUSED_MESSAGE : BUSY_MESSAGE);
      }
      throw new RunBlockedError(state.projectId === projectId ? HERO_SHEET_SCENES_BUSY : BUSY_MESSAGE);
    }
    await commit(reduceRun(initHeroSheetRun(project), { type: 'start' }));
  });
  void pump();
}

/**
 * The owner chose one of a scene's pictures. While this project has a run (live or finished) the run's state takes it,
 * so the choice is saved with the project and survives every later broadcast; otherwise the stored project takes it
 * (and nothing is broadcast: the studio re-reads the project). Either way the activity log says "Swapped to picture K".
 */
export async function chooseScenePicture(projectId: string, sceneId: string, pictureId: string): Promise<void> {
  await ready;
  const option = await enqueue(async () => {
    const inRun = state?.projectId === projectId && !isHeroSheetRun(state) ? state.sceneStates[sceneId] : undefined;
    if (state && inRun) {
      if (!inRun.pictureIds.includes(pictureId)) throw new Error(NOT_THIS_SCENES_PICTURE);
      await commit(reduceRun(state, { type: 'choose', sceneId, pictureId }));
      return inRun.pictureIds.indexOf(pictureId) + 1;
    }
    const project = await getProject(projectId);
    const scene = project?.sceneStates[sceneId];
    if (!project || !scene || !scene.pictureIds.includes(pictureId)) throw new Error(NOT_THIS_SCENES_PICTURE);
    project.sceneStates = { ...project.sceneStates, [sceneId]: { ...scene, chosenPictureId: pictureId } };
    await saveProject(project);
    return scene.pictureIds.indexOf(pictureId) + 1;
  });
  // Written before the studio hears back, so its activity list shows the line with the swap. A log failure never
  // undoes the choice.
  await logActivity({ at: Date.now(), projectId, sceneId, text: `Swapped to picture ${option}` }).catch((err) =>
    console.warn('[VidFlow] activity write failed', err),
  );
}

export const pauseRun = () => dispatch({ type: 'pause' });
export async function resumeRun(): Promise<void> {
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
    await commit(
      reduceRun(state, {
        type: 'failed',
        sceneId,
        // A scene VidFlow couldn't match consistently says so, rather than blaming Flow's speed.
        message: unconfirmedStreak.has(sceneId)
          ? UNCONFIRMED_MESSAGE
          : "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
      }),
    );
  });
  void pump();
  void processTiles();
}

/** Register listeners synchronously from the background entry, once. */
export function registerCoordinator(): void {
  ready = load().catch(() => undefined);
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
  });
}

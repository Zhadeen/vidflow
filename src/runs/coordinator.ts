/// <reference types="chrome" />
import type { FlowResultCard, StartVerb } from '../flow/driver';
import { matchResults, unverifiedKeys, UNCONFIRMED_MESSAGE, verifyMatch, type Submission } from '../flow/match';
import { FlowBlockedError, type Point, type SubmitOptions } from '../flow/messages';
import { flowProjectAction, isFlowHome, projectUrlOf } from '../flow/project';
import { pillView, type PillView } from '../flow/pill';
import { detachFlowDebugger } from '../flow/press';
import { buildImagePrompt } from '../prompts/build';
import { customStyle, STYLE_PRESETS } from '../prompts/styles';
import { getMediaStore, getProject, saveProject, type Project, type SceneState } from '../store/projects';
import {
  initRun,
  nextSceneToSubmit,
  normaliseEvent,
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
  /** After pressing Generate: true once Flow cleared the box or showed a new in-progress tile (~8 s). */
  confirmStarted(tabId: number): Promise<boolean>;
  /** The result tiles in the Flow tab's DOM right now. */
  tiles(tabId: number): Promise<FlowResultCard[]>;
  /** Where the finished tile with this media id is (scrolled into view), to open its detail view. */
  tilePoint(tabId: number, key: string): Promise<Point>;
  /** On a picture's detail page: the full prompt it shows, and the picture's media id when the page has one. */
  readDetail(tabId: number): Promise<{ prompt: string | null; mediaId: string | null }>;
}

// Plain dark square; the extension has no icon files yet (chrome requires an iconUrl on basic notifications).
const NOTIFICATION_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const RUN_KEY = 'vidflow.run';
const WINDOW_KEY = 'vidflow.flowWindow';
const SESSION_MARKER = 'vidflow.sessionAlive';
const RESUME_ALARM = 'vidflow-resume';
const DEADLINE_PREFIX = 'vidflow-deadline:';
const DEADLINE_MINUTES = 10;
const FLOW_URL = 'https://flow.google.com/';
const MAX_IN_FLIGHT = 3;
const PACE_MIN_MS = 4000;
const PACE_MAX_MS = 7000;
const URL_WAIT_MS = 30_000;
const URL_POLL_MS = 500;
const BACK_WAIT_MS = 5_000;
// A blocked run is always left paused, so owner-facing messages from the pump name Resume.
const PUMP_VERB: StartVerb = 'Resume';
export const NOT_STARTED_MESSAGE = "VidFlow pressed Generate but Flow didn't start. Check the Flow window, then press Resume.";
/** Tile reports this soon after returning from a detail page don't count towards giving up on a scene. */
const SETTLE_MS = 3_000;
/** Consecutive qualifying reports (or unreadable detail reads) before VidFlow gives up on a scene. */
const GIVE_UP_AFTER = 2;
const SAVE_FAILED_MESSAGE = "VidFlow couldn't save this scene's pictures. Press Try again.";
const NO_PROJECT_MESSAGE = "VidFlow pressed New project but Flow didn't open one. Check the Flow window, then press Resume.";

export const BUSY_MESSAGE = 'Another project is making pictures right now. Pause it or wait for it to finish, then try again.';

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const paceMs = () => PACE_MIN_MS + Math.random() * (PACE_MAX_MS - PACE_MIN_MS);

function notify(message: string): void {
  void chrome.notifications.create({ type: 'basic', iconUrl: NOTIFICATION_ICON, title: 'VidFlow', message });
}

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

function isFlowUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('https://flow.google.com/') || url.startsWith('https://labs.google/'));
}

/** Returns the tab id of VidFlow's own Flow tab, opening a dedicated window if needed. */
async function ensureFlowTab(): Promise<number> {
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

/** Page zoom changes what CSS pixels mean to the debugger's input; keep VidFlow's tab at 100% (the port scales otherwise). */
async function resetZoom(tabId: number): Promise<void> {
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

/** Polls the tab until its URL satisfies `ok`; returns that URL, or null after URL_WAIT_MS. */
async function waitForUrl(tabId: number, ok: (url: string) => boolean, waitMs = URL_WAIT_MS): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const url = await tabUrl(tabId);
    if (url && ok(url)) return url;
    if (Date.now() >= deadline) return null;
    await sleep(URL_POLL_MS);
  }
}

// ---- State changes -------------------------------------------------------

async function syncDeadlines(prev: RunState | null, next: RunState): Promise<void> {
  const before = new Set(prev?.inFlight ?? []);
  const after = new Set(next.inFlight);
  for (const id of before) if (!after.has(id)) await chrome.alarms.clear(DEADLINE_PREFIX + id);
  for (const id of after) {
    if (!before.has(id)) await chrome.alarms.create(DEADLINE_PREFIX + id, { delayInMinutes: DEADLINE_MINUTES });
  }
}

function announce(prev: RunState | null, next: RunState): void {
  if (prev?.status === next.status) return;
  if (next.status === 'paused' && next.pauseReason && next.pauseReason !== USER_PAUSE_REASON) {
    notify(typeof next.resumeAt === 'number' ? next.pauseReason : `VidFlow paused: ${next.pauseReason}`);
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

  // Re-read the project so edits made in Studio meanwhile are not overwritten; only sceneStates is ours.
  const project = await getProject(next.projectId);
  if (project) {
    project.sceneStates = { ...project.sceneStates, ...next.sceneStates };
    await saveProject(project);
  }

  if (next.status === 'running') chrome.power.requestKeepAwake('system');
  else {
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

/** True while the run that the pump is working for is still running. Checked right before every press. */
function stillRunning(projectId: string): boolean {
  return state?.status === 'running' && state.projectId === projectId;
}

/**
 * Puts the Flow tab on this run's own project, creating a fresh one on the run's first scene (spec §16.5).
 * Returns false when the run stopped meanwhile (nothing pressed). Throws FlowBlockedError when the owner must act.
 */
async function ensureFlowProject(tabId: number, projectId: string): Promise<boolean> {
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
  const at = await port!.findNewProject(tabId, PUMP_VERB);
  if (!stillRunning(projectId)) return false;
  await port!.press(tabId, at.x, at.y);
  const url = await waitForUrl(tabId, (u) => projectUrlOf(u) !== null);
  const flowProjectUrl = projectUrlOf(url ?? undefined);
  if (!flowProjectUrl) {
    throw new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message: NO_PROJECT_MESSAGE });
  }
  await enqueue(async () => {
    if (state?.projectId === projectId) await commit({ ...state, flowProjectUrl });
  });
  return true;
}

const isFinished = (c: FlowResultCard) => c.imageUrl !== null && c.progress === null && !c.key.startsWith('pending-');
const oldestFirst = (cards: FlowResultCard[]) => [...cards].sort((a, b) => b.domIndex - a.domIndex);

/** Flow card keys already saved for a scene; never matched again. */
function claimedKeys(s: RunState): Set<string> {
  return new Set(Object.values(s.sceneStates).flatMap((x) => x.cardKeys ?? []));
}

/**
 * Sends one scene to Flow. Holds the tab. 'stop' ends this pump round (paused, stopped, or blocked); the scene stays
 * pending unless Flow confirmed the start.
 */
async function submitScene(tabId: number, project: Project, sceneId: string, prompt: string): Promise<'stop' | 'next'> {
  const projectId = project.id;
  try {
    if (!(await ensureFlowProject(tabId, projectId))) return 'stop'; // stopped meanwhile; scene stays pending
    const unconfirmed = state?.sceneStates[sceneId]?.unconfirmed;
    if (unconfirmed) {
      // A press whose start VidFlow didn't see may still have worked: look before pressing again (no surplus batch).
      const found = await findUnconfirmedStart(tabId, project, unconfirmed);
      if (found === null) return 'stop';
      if (found === 'wait') return 'next'; // look again after the pace pause, without pressing
      if (found) {
        await dispatch({ type: 'submitted', sceneId, prompt: unconfirmed.prompt, at: Date.now() });
        return 'next';
      }
    }
    const at = await port!.prepare(tabId, sceneId, prompt, {
      aspect: project.aspect,
      outputs: project.outputsPerPrompt,
      verb: PUMP_VERB,
    });
    // Preparing can take ~40 s: if the owner paused (or the run ended) meanwhile, don't press; the scene stays pending.
    if (!stillRunning(projectId)) return 'stop';
    const keysBefore = (await port!.tiles(tabId)).filter(isFinished).map((c) => c.key);
    if (!stillRunning(projectId)) return 'stop';
    await port!.press(tabId, at.x, at.y);
    if (!stillRunning(projectId)) await detachFlowDebugger(tabId);
    if (!(await port!.confirmStarted(tabId))) {
      await dispatch({ type: 'unconfirmed', sceneId, keysBefore, prompt });
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
  const fresh = oldestFirst(await port!.tiles(tabId)).filter((c) => !before.has(c.key) && !claimed.has(c.key));
  const samePromptInFlight = state.inFlight.filter((id) =>
    verifyMatch(u.prompt, state?.sceneStates[id]?.submission?.prompt ?? ''),
  ).length;
  const owedToOthers = samePromptInFlight * project.outputsPerPrompt;
  let hits = 0;
  let generating = 0;
  const attempt = -++unconfirmedAttempt; // each Resume check is its own attempt (tile reports count up from 1)
  for (const card of fresh) {
    let ok: boolean;
    if (isFinished(card)) {
      const detail = await detailOf(tabId, project.id, card.key, attempt);
      if (detail === null) return null;
      if (detail === 'unread') return 'wait';
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
  const read = await readDetailFor(tabId, projectId, key);
  if (!stillRunning(projectId)) return null;
  if (read === null) {
    const tries = (unreadCount.get(key)?.count ?? 0) + 1;
    unreadCount.set(key, { count: tries, attempt });
    if (tries < GIVE_UP_AFTER) return 'unread';
    await dispatch({ type: 'detail', cardKey: key, prompt: '' });
    return '';
  }
  await dispatch({ type: 'detail', cardKey: key, prompt: read });
  return read;
}

/**
 * Opens a card's detail view in the Flow tab (trusted press on the tile), reads the full prompt, and goes back to the
 * run's project. null when anything doesn't line up. Holds the tab.
 */
async function readDetailFor(tabId: number, projectId: string, key: string): Promise<string | null> {
  const flowUrl = state?.flowProjectUrl;
  if (!flowUrl || !port || !stillRunning(projectId)) return null;
  const onProject = (u: string) => projectUrlOf(u) === flowUrl && !/\/edit\//.test(u);
  inDetail = true;
  try {
    const now = await tabUrl(tabId);
    if (!now || !onProject(now)) {
      await chrome.tabs.update(tabId, { url: flowUrl });
      if (!(await waitForUrl(tabId, onProject))) return null;
    }
    const at = await port.tilePoint(tabId, key);
    if (!stillRunning(projectId)) return null;
    await port.press(tabId, at.x, at.y);
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
          back = (await waitForUrl(tabId, onProject, BACK_WAIT_MS)) !== null;
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

/** Settles every in-flight scene the latest tiles complete. A picture is saved only after its detail prompt verifies. */
async function matchOnce(): Promise<void> {
  for (let round = 0; round < 100; round++) {
    if (!state || state.status !== 'running' || !port) return;
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
    const cards = report.cards;
    const details = run.detailPrompts ?? {};
    const matches = matchResults(submissions, cards, claimedKeys(run), project.outputsPerPrompt, details);
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

/** Fetches each verified card's picture (signed URL, extension-only) and stores it as scene-NN-option-K. */
async function savePictures(project: Project, sceneId: string, cardKeys: string[], cards: FlowResultCard[]): Promise<void> {
  const nn = String(project.scenes.findIndex((s) => s.id === sceneId) + 1).padStart(2, '0');
  try {
    const mediaIds: string[] = [];
    for (const [i, key] of cardKeys.entries()) {
      const url = cards.find((c) => c.key === key)?.imageUrl;
      if (!url) throw new Error('no picture address');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`picture fetch ${res.status}`);
      mediaIds.push(await getMediaStore().put(project.id, `scene-${nn}-option-${i + 1}`, await res.blob()));
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
      const sceneId = nextSceneToSubmit(state, project.scenes.map((s) => s.id), MAX_IN_FLIGHT);
      if (!sceneId) return;
      const scene = project.scenes.find((s) => s.id === sceneId);
      if (!scene) return void (await pauseWith(`VidFlow couldn't find ${sceneId} in this project.`));
      if (!port) return void (await pauseWith("VidFlow isn't connected to Flow yet. Open VidFlow again, then press Resume."));

      let tabId: number;
      try {
        tabId = await ensureFlowTab();
      } catch {
        return void (await pauseWith("VidFlow couldn't open its Flow window. Check Chrome, then press Resume."));
      }
      const prompt = buildImagePrompt(scene, projectStyle(project), project.character);
      if ((await withTab(() => submitScene(tabId, project, sceneId, prompt))) === 'stop') return;
      await sleep(paceMs());
    }
  } finally {
    pumping = false;
  }
}

// ---- Public API ----------------------------------------------------------

/** Why a run for `projectId` can't start now (another project's run is running, or paused with work left), or null. */
async function startBlocker(projectId: string): Promise<string | null> {
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
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
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
  if (state?.projectId === projectId && state.status !== 'idle') return dispatch({ type: 'retry', sceneId });
  return startRun(projectId, sceneId);
}

export const pauseRun = () => dispatch({ type: 'pause' });
export const resumeRun = () => dispatch({ type: 'resume' });

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
export async function pillFor(tabId: number | undefined): Promise<PillView | null> {
  await ready;
  return (await isFlowTab(tabId)) ? pillView(state) : null;
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
  } else if (saved.status === 'running') {
    chrome.power.requestKeepAwake('system');
  }
}

/** Register listeners synchronously from the background entry, once. */
export function registerCoordinator(): void {
  ready = load().catch(() => undefined);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESUME_ALARM) void resumeRun();
    else if (alarm.name.startsWith(DEADLINE_PREFIX)) {
      const sceneId = alarm.name.slice(DEADLINE_PREFIX.length);
      void ready?.then(() => {
        if (state?.inFlight.includes(sceneId)) {
          void dispatch({
            type: 'failed',
            sceneId,
            // A scene VidFlow couldn't match consistently says so, rather than blaming Flow's speed.
            message: unconfirmedStreak.has(sceneId)
              ? UNCONFIRMED_MESSAGE
              : "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
          });
        }
      });
    }
  });
  chrome.windows.onRemoved.addListener(async (windowId) => {
    const saved = await savedFlowWindow();
    if (saved?.windowId === windowId) await forgetFlowWindow();
  });
  chrome.runtime.onStartup.addListener(() => void forgetFlowWindow());
  void ready.then(() => pump());
}

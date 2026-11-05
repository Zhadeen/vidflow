/// <reference types="chrome" />
import type { StartVerb } from '../flow/driver';
import { FlowBlockedError, type Point, type SubmitOptions } from '../flow/messages';
import { flowProjectAction, isFlowHome, projectUrlOf } from '../flow/project';
import { pillView, type PillView } from '../flow/pill';
import { detachFlowDebugger } from '../flow/press';
import { buildImagePrompt } from '../prompts/build';
import { customStyle, STYLE_PRESETS } from '../prompts/styles';
import { getProject, saveProject, type Project } from '../store/projects';
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
// A blocked run is always left paused, so owner-facing messages from the pump name Resume.
const PUMP_VERB: StartVerb = 'Resume';
export const NOT_STARTED_MESSAGE = "VidFlow pressed Generate but Flow didn't start. Check the Flow window, then press Resume.";
const NO_PROJECT_MESSAGE = "VidFlow pressed New project but Flow didn't open one. Check the Flow window, then press Resume.";

interface FlowWindow {
  windowId: number;
  tabId: number;
}

let port: FlowPort | null = null;
let state: RunState | null = null;
let pumping = false;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Run `fn` after everything queued before it, so state changes and saves never interleave. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.catch(() => undefined);
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
async function waitForUrl(tabId: number, ok: (url: string) => boolean): Promise<string | null> {
  const deadline = Date.now() + URL_WAIT_MS;
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
}

async function dispatch(event: RunEvent): Promise<void> {
  await ready;
  await enqueue(async () => {
    if (!state) return;
    await commit(reduceRun(state, normaliseEvent(event, Date.now())));
  });
  void pump();
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
      try {
        if (!(await ensureFlowProject(tabId, projectId))) return; // stopped meanwhile; scene stays pending
        const at = await port.prepare(tabId, sceneId, buildImagePrompt(scene, projectStyle(project), project.character), {
          aspect: project.aspect,
          outputs: project.outputsPerPrompt,
          verb: PUMP_VERB,
        });
        // Preparing can take ~40 s: if the owner paused (or the run ended) meanwhile, don't press; the scene stays pending.
        if (!stillRunning(projectId)) return;
        await port.press(tabId, at.x, at.y);
        if (!stillRunning(projectId)) await detachFlowDebugger(tabId);
        if (!(await port.confirmStarted(tabId))) {
          return void (await dispatch({ type: 'needsOwner', reason: 'page-not-recognised', message: NOT_STARTED_MESSAGE }));
        }
        await dispatch({ type: 'submitted', sceneId });
      } catch (err) {
        // The page needs the owner (wrong account, limit, policy dialog…): pause, and leave the scene queued.
        if (err instanceof FlowBlockedError) return void (await dispatch(err.event));
        await dispatch({
          type: 'failed',
          sceneId,
          message: "VidFlow couldn't send this scene to Flow. Press Try again to send it again.",
        });
      }
      await sleep(paceMs());
    }
  } finally {
    pumping = false;
  }
}

// ---- Public API ----------------------------------------------------------

export async function startRun(projectId: string): Promise<void> {
  await ready;
  const project = await getProject(projectId);
  if (!project) throw new Error('That project is no longer in VidFlow.');
  await enqueue(() => commit(reduceRun(initRun(project), { type: 'start' })));
  void pump();
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
            message: "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
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

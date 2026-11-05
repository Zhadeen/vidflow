/// <reference types="chrome" />
import { buildImagePrompt } from '../prompts/build';
import { customStyle, STYLE_PRESETS } from '../prompts/styles';
import { getProject, saveProject, type Project } from '../store/projects';
import { initRun, nextSceneToSubmit, reduceRun, runSummary, type RunEvent, type RunState } from './run';

/** How the coordinator talks to Flow. The content-script messaging (Task 7) implements this. */
export interface FlowPort {
  submit(sceneId: string, prompt: string): Promise<void>;
}

// Plain dark square; the extension has no icon files yet (chrome requires an iconUrl on basic notifications).
const NOTIFICATION_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const RUN_KEY = 'vidflow.run';
const WINDOW_KEY = 'vidflow.flowWindowId';
const RESUME_ALARM = 'vidflow-resume';
const FLOW_URL = 'https://flow.google.com/';
const MAX_IN_FLIGHT = 3;
const PACE_MIN_MS = 4000;
const PACE_MAX_MS = 7000;

let port: FlowPort | null = null;
let state: RunState | null = null;
let pumping = false;

export function setFlowPort(p: FlowPort): void {
  port = p;
}

export function getRunState(): RunState | null {
  return state;
}

function paceMs(): number {
  return PACE_MIN_MS + Math.random() * (PACE_MAX_MS - PACE_MIN_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function notify(message: string): void {
  void chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'VidFlow',
    message,
  });
}

function projectStyle(project: Project) {
  return project.style === 'custom' ? customStyle(project.customStyle ?? '') : STYLE_PRESETS[project.style];
}

async function ensureFlowWindow(): Promise<void> {
  const stored = (await chrome.storage.local.get(WINDOW_KEY))[WINDOW_KEY] as number | undefined;
  if (stored !== undefined) {
    try {
      await chrome.windows.get(stored);
      return;
    } catch {
      // The window was closed; open a new one below.
    }
  }
  const created = await chrome.windows.create({ url: FLOW_URL, focused: false, type: 'normal' });
  if (created?.id !== undefined) await chrome.storage.local.set({ [WINDOW_KEY]: created.id });
}

/** Persist, mirror scene states back to the project, and keep alarms / keep-awake in step. */
async function commit(next: RunState): Promise<void> {
  const prev = state;
  state = next;
  await chrome.storage.local.set({ [RUN_KEY]: next });

  const project = await getProject(next.projectId);
  if (project) {
    project.sceneStates = { ...project.sceneStates, ...next.sceneStates };
    await saveProject(project);
  }

  if (next.status === 'running') chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();

  if (next.status === 'paused' && typeof next.resumeAt === 'number') {
    await chrome.alarms.create(RESUME_ALARM, { when: next.resumeAt });
  } else {
    await chrome.alarms.clear(RESUME_ALARM);
  }

  if (prev?.status === next.status) return;
  if (next.status === 'paused' && next.pauseReason) {
    notify(`VidFlow paused: ${next.pauseReason}`);
  } else if (next.status === 'finished') {
    const { done, refused, failed } = runSummary(next);
    let msg = `All ${done} pictures are done.`;
    if (refused.length) msg += ` ${refused.length} ${refused.length === 1 ? 'scene was' : 'scenes were'} refused — open VidFlow to see why.`;
    if (failed.length) msg += ` ${failed.length} ${failed.length === 1 ? 'scene' : 'scenes'} could not be made — open VidFlow to retry.`;
    notify(msg);
  }
}

async function apply(event: RunEvent): Promise<void> {
  if (!state) return;
  await commit(reduceRun(state, event));
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      if (!state || !port) return;
      const project = await getProject(state.projectId);
      if (!project) return;
      const order = project.scenes.map((s) => s.id);
      const sceneId = nextSceneToSubmit(state, order, MAX_IN_FLIGHT);
      if (!sceneId) return;
      const scene = project.scenes.find((s) => s.id === sceneId);
      if (!scene) return;

      const prompt = buildImagePrompt(scene, projectStyle(project), project.character);
      try {
        await ensureFlowWindow();
        await port.submit(sceneId, prompt);
        await commit(reduceRun(state, { type: 'submitted', sceneId }));
      } catch (err) {
        await commit(
          reduceRun(state, { type: 'failed', sceneId, message: err instanceof Error ? err.message : 'Could not send the prompt to Flow.' }),
        );
      }
      await sleep(paceMs());
    }
  } finally {
    pumping = false;
  }
}

export async function startRun(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error('That project no longer exists.');
  await commit(reduceRun(initRun(project), { type: 'start' }));
  void pump();
}

export async function pauseRun(): Promise<void> {
  await apply({ type: 'pause' });
}

export async function resumeRun(): Promise<void> {
  await apply({ type: 'resume' });
}

/** The background calls this when the Flow helper reports something. */
export async function handleFlowEvent(event: RunEvent): Promise<void> {
  await apply(event);
}

/** Call once when the background starts: bring back a run that was interrupted by a Chrome restart. */
export async function restoreRun(): Promise<void> {
  const saved = (await chrome.storage.local.get(RUN_KEY))[RUN_KEY] as RunState | undefined;
  if (!saved) return;
  state = saved;
  if (saved.status === 'running') await apply({ type: 'resume' });
  else if (saved.status === 'paused' && typeof saved.resumeAt === 'number' && saved.resumeAt <= Date.now()) {
    await apply({ type: 'resume' });
  }
}

/** Register the resume alarm listener. Call once from the background entry. */
export function registerCoordinator(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESUME_ALARM) void resumeRun();
  });
  void restoreRun();
}

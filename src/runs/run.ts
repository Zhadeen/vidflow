import type { Project, SceneState } from '../store/projects';

export type RunEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restore' } // after a real browser restart: pages are gone, so submitted scenes go back in the queue
  | { type: 'submitted'; sceneId: string; prompt?: string; at?: number }
  | { type: 'pictures'; sceneId: string; mediaIds: string[]; cardKeys?: string[] }
  /**
   * Generate is about to be pressed (recorded first, so a worker suspended mid-press looks before pressing again), or
   * was pressed but Flow's start wasn't seen. The scene stays pending until `submitted`; `at` starts its wait limit.
   */
  | { type: 'unconfirmed'; sceneId: string; keysBefore: string[]; prompt: string; at?: number }
  /** The full prompt read from a Flow card's detail view. */
  | { type: 'detail'; cardKey: string; prompt: string }
  | { type: 'refused'; sceneId: string; message: string }
  | { type: 'failed'; sceneId: string; message: string }
  /** The owner stopped the run: nothing more is sent; scenes in Flow go back to waiting; pictures stay. */
  | { type: 'stop' }
  /** The owner pressed Try again on a refused or failed scene: it goes back in the queue. */
  | { type: 'retry'; sceneId: string }
  /** The owner chose which of a scene's pictures it uses (ignored unless it is one of them). */
  | { type: 'choose'; sceneId: string; pictureId: string }
  | { type: 'limit'; message: string; resumeAt: number | null }
  | {
      type: 'needsOwner';
      reason: 'policy-dialog' | 'signed-out' | 'wrong-account' | 'page-not-recognised';
      message: string;
    };

export const USER_PAUSE_REASON = 'Paused by you';

/** Said when a picture choice names a picture the scene doesn't have (or a scene the project doesn't have). */
export const NOT_THIS_SCENES_PICTURE =
  "That picture isn't one of this scene's pictures any more. Pick one of the pictures shown.";

export interface RunState {
  projectId: string;
  status: 'idle' | 'running' | 'paused' | 'finished';
  pauseReason?: string;
  resumeAt?: number | null;
  inFlight: string[];
  sceneStates: Record<string, SceneState>;
  /** The fresh Flow project this run works in (spec §16.5). Unset until the run creates it; a new run starts without. */
  flowProjectUrl?: string;
  /** Submission counter for result matching (Flow lists tiles in submission order). */
  nextSeq?: number;
  /** Full prompts read from Flow cards' detail views, by card key (verification before saving). */
  detailPrompts?: Record<string, string>;
}

/** Every scene without a done/refused state starts (again) as pending. */
export function initRun(project: Project): RunState {
  const sceneStates: Record<string, SceneState> = {};
  for (const scene of project.scenes) {
    const existing = project.sceneStates[scene.id];
    sceneStates[scene.id] =
      existing && (existing.status === 'done' || existing.status === 'refused')
        ? { ...existing }
        : { sceneId: scene.id, status: 'pending', pictureIds: existing?.pictureIds ?? [] };
  }
  return { projectId: project.id, status: 'idle', inFlight: [], sceneStates };
}

function hasUnfinished(state: RunState): boolean {
  return Object.values(state.sceneStates).some((s) => s.status === 'pending' || s.status === 'submitted');
}

function settle(state: RunState): RunState {
  return state.status === 'running' && !hasUnfinished(state) ? { ...state, status: 'finished' } : state;
}

function setScene(state: RunState, sceneId: string, patch: Partial<SceneState>): RunState {
  const current = state.sceneStates[sceneId];
  if (!current) return state;
  return {
    ...state,
    inFlight: state.inFlight.filter((id) => id !== sceneId),
    sceneStates: { ...state.sceneStates, [sceneId]: { ...current, ...patch } },
  };
}

/** Anything still submitted is stale (the page it was on is gone): put it back in the queue. */
function requeueSubmitted(state: RunState): RunState {
  const sceneStates: Record<string, SceneState> = {};
  for (const [id, s] of Object.entries(state.sceneStates)) {
    if (s.status !== 'submitted') sceneStates[id] = s;
    else {
      const { submission: _gone, ...rest } = s;
      sceneStates[id] = { ...rest, status: 'pending' };
    }
  }
  return { ...state, inFlight: [], sceneStates };
}

/**
 * The unconfirmed wait limit counts running time only: on start/resume each pending scene's unconfirmed clock starts
 * again (as its deadline alarms are re-armed), so a long pause can't fail it at the first look afterwards.
 */
function restartUnconfirmedClocks(state: RunState): RunState {
  const now = Date.now();
  let sceneStates = state.sceneStates;
  for (const [id, s] of Object.entries(state.sceneStates)) {
    if (s.status !== 'pending' || !s.unconfirmed) continue;
    sceneStates = { ...sceneStates, [id]: { ...s, unconfirmed: { ...s.unconfirmed, at: now } } };
  }
  return sceneStates === state.sceneStates ? state : { ...state, sceneStates };
}

function clearPause(state: RunState): RunState {
  const { pauseReason: _r, resumeAt: _t, ...rest } = state;
  return rest;
}

export function reduceRun(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'start':
      return settle({ ...clearPause(restartUnconfirmedClocks(requeueSubmitted(state))), status: 'running' });
    case 'resume':
      if (state.status === 'running') return state;
      return settle({ ...clearPause(restartUnconfirmedClocks(state)), status: 'running' });
    case 'restore':
      return requeueSubmitted(state);
    case 'pause':
      if (state.status !== 'running' && state.status !== 'paused') return state; // nothing to pause
      return { ...state, status: 'paused', pauseReason: USER_PAUSE_REASON, resumeAt: null };
    case 'submitted': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status !== 'pending') return state;
      const seq = (state.nextSeq ?? 0) + 1;
      const { unconfirmed: _seen, ...rest } = current;
      const submission = { seq, at: event.at ?? Date.now(), prompt: event.prompt ?? '' };
      return {
        ...state,
        nextSeq: seq,
        inFlight: [...state.inFlight.filter((id) => id !== event.sceneId), event.sceneId],
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...rest, status: 'submitted', submission } },
      };
    }
    case 'unconfirmed': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status !== 'pending') return state;
      const unconfirmed = { keysBefore: event.keysBefore, prompt: event.prompt, at: event.at ?? Date.now() };
      return { ...state, sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, unconfirmed } } };
    }
    case 'detail':
      return { ...state, detailPrompts: { ...state.detailPrompts, [event.cardKey]: event.prompt } };
    case 'pictures':
      if (!state.inFlight.includes(event.sceneId)) return state; // stale
      return settle(
        setScene(state, event.sceneId, {
          status: 'done',
          pictureIds: event.mediaIds,
          chosenPictureId: undefined, // new pictures: the best-picture choice is made again (Plan 2)
          message: undefined,
          ...(event.cardKeys ? { cardKeys: event.cardKeys } : {}),
        }),
      );
    case 'refused':
    case 'failed': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status === 'done') return state;
      return settle(
        setScene(state, event.sceneId, { status: event.type === 'refused' ? 'refused' : 'failed', message: event.message }),
      );
    }
    case 'stop':
      return { ...clearPause(requeueSubmitted(state)), status: 'idle' };
    case 'retry': {
      const current = state.sceneStates[event.sceneId];
      if (!current || (current.status !== 'refused' && current.status !== 'failed')) return state;
      const { message: _m, submission: _s, unconfirmed: _u, ...rest } = current;
      return {
        ...state,
        // A finished run carries on with the re-queued scene; a paused one waits for Resume.
        status: state.status === 'finished' ? 'running' : state.status,
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...rest, status: 'pending' } },
      };
    }
    case 'choose': {
      const current = state.sceneStates[event.sceneId];
      if (!current || !current.pictureIds.includes(event.pictureId)) return state;
      return { ...state, sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, chosenPictureId: event.pictureId } } };
    }
    case 'limit':
      return { ...state, status: 'paused', pauseReason: event.message, resumeAt: event.resumeAt };
    case 'needsOwner':
      return { ...state, status: 'paused', pauseReason: event.message, resumeAt: null };
  }
}

export function nextSceneToSubmit(state: RunState, order: string[], maxInFlight: number): string | null {
  if (state.status !== 'running' || state.inFlight.length >= maxInFlight) return null;
  for (const id of order) {
    if (state.sceneStates[id]?.status === 'pending' && !state.inFlight.includes(id)) return id;
  }
  return null;
}

export function runSummary(state: RunState): { done: number; refused: string[]; failed: string[]; pending: number } {
  const all = Object.values(state.sceneStates);
  return {
    done: all.filter((s) => s.status === 'done').length,
    refused: all.filter((s) => s.status === 'refused').map((s) => s.sceneId),
    failed: all.filter((s) => s.status === 'failed').map((s) => s.sceneId),
    pending: all.filter((s) => s.status === 'pending' || s.status === 'submitted').length,
  };
}

/** The next 00:00 local time strictly after `now`. */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Fill in what Flow could not tell us: a missing reset time becomes local midnight, and the message says when we carry on. */
export function normaliseEvent(event: RunEvent, now: number): RunEvent {
  if (event.type !== 'limit') return event;
  const resumeAt = event.resumeAt ?? nextLocalMidnight(now);
  return { type: 'limit', resumeAt, message: `Flow's daily limit was reached. VidFlow will carry on at ${clock(resumeAt)}.` };
}

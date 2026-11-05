import type { Project, SceneState } from '../store/projects';

export type RunEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'submitted'; sceneId: string }
  | { type: 'pictures'; sceneId: string; mediaIds: string[] }
  | { type: 'refused'; sceneId: string; message: string }
  | { type: 'failed'; sceneId: string; message: string }
  | { type: 'limit'; message: string; resumeAt: number | null }
  | {
      type: 'needsOwner';
      reason: 'policy-dialog' | 'signed-out' | 'wrong-account' | 'page-not-recognised';
      message: string;
    };

export interface RunState {
  projectId: string;
  status: 'idle' | 'running' | 'paused' | 'finished';
  pauseReason?: string;
  resumeAt?: number | null;
  inFlight: string[];
  sceneStates: Record<string, SceneState>;
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
    sceneStates[id] = s.status === 'submitted' ? { ...s, status: 'pending' } : s;
  }
  return { ...state, inFlight: [], sceneStates };
}

function clearPause(state: RunState): RunState {
  const { pauseReason: _r, resumeAt: _t, ...rest } = state;
  return rest;
}

export function reduceRun(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'start':
    case 'resume':
      return settle({ ...clearPause(requeueSubmitted(state)), status: 'running' });
    case 'pause':
      return { ...state, status: 'paused', pauseReason: 'Paused by you', resumeAt: null };
    case 'submitted': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status !== 'pending') return state;
      return {
        ...state,
        inFlight: [...state.inFlight.filter((id) => id !== event.sceneId), event.sceneId],
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, status: 'submitted' } },
      };
    }
    case 'pictures':
      if (!state.inFlight.includes(event.sceneId)) return state; // stale
      return settle(setScene(state, event.sceneId, { status: 'done', pictureIds: event.mediaIds, message: undefined }));
    case 'refused':
    case 'failed': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status === 'done') return state;
      return settle(
        setScene(state, event.sceneId, { status: event.type === 'refused' ? 'refused' : 'failed', message: event.message }),
      );
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

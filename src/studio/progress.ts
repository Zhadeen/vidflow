import { USER_PAUSE_REASON, type RunState } from '../runs/run';
import type { Project, SceneState } from '../store/projects';

/** This project's run, if the background's current run is this project's. */
export function runFor(project: Project, run: RunState | null): RunState | null {
  return run && run.projectId === project.id ? run : null;
}

/**
 * Each scene's state as the studio should show it. A live (running/paused) run is fresher than the saved project;
 * otherwise the saved project is the truth (the coordinator saves it before it announces a change).
 */
export function sceneStatesFor(project: Project, run: RunState | null): Record<string, SceneState> {
  const mine = runFor(project, run);
  const live = mine && mine.status !== 'idle' ? mine.sceneStates : {};
  const out: Record<string, SceneState> = {};
  for (const scene of project.scenes) {
    out[scene.id] = live[scene.id] ?? project.sceneStates[scene.id] ?? { sceneId: scene.id, status: 'pending', pictureIds: [] };
  }
  return out;
}

export interface PictureProgress {
  done: number;
  total: number;
  refused: string[];
  failed: string[];
  working: string[];
}

export function pictureProgress(project: Project, run: RunState | null): PictureProgress {
  const states = sceneStatesFor(project, run);
  const ids = project.scenes.map((s) => s.id);
  return {
    done: ids.filter((id) => states[id].status === 'done').length,
    total: ids.length,
    refused: ids.filter((id) => states[id].status === 'refused'),
    failed: ids.filter((id) => states[id].status === 'failed'),
    working: ids.filter((id) => states[id].status === 'submitted'),
  };
}

export type RunPhase = 'idle' | 'running' | 'paused' | 'finished';

export function runPhase(project: Project, run: RunState | null): RunPhase {
  const mine = runFor(project, run);
  if (!mine || mine.status === 'idle') return 'idle';
  // A finished run with scenes still to make (a new scene file since) is over: the project is ready to start again.
  if (mine.status === 'finished' && project.scenes.some((s) => (project.sceneStates[s.id]?.status ?? 'pending') === 'pending')) {
    return 'idle';
  }
  return mine.status;
}

/** A pause the owner must act on (not one he asked for). */
export function ownerPauseReason(project: Project, run: RunState | null): string | null {
  const mine = runFor(project, run);
  if (!mine || mine.status !== 'paused' || !mine.pauseReason || mine.pauseReason === USER_PAUSE_REASON) return null;
  return mine.pauseReason;
}

export const sceneNumber = (project: Project, sceneId: string) =>
  String(project.scenes.findIndex((s) => s.id === sceneId) + 1).padStart(2, '0');

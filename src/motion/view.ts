import { NOT_AUTO_CHECKED } from '../runs/autopick';
import { isAutoPickRun, isClipRun, USER_PAUSE_REASON, type RunState } from '../runs/run';
import type { MotionMode, Project, SceneState } from '../store/projects';
import { choiceSourceOf } from '../studio/chosen';
import { clipIsCurrent, estimate } from './clips';

/**
 * What the panel's Motion section and the studio's Motion step show (spec §20): pure, so both read the same words.
 */

export const MOTION_CHOICES: { value: MotionMode; label: string }[] = [
  { value: 'stills', label: 'Stills only' },
  { value: 'picked', label: 'Clips for the slides I pick' },
  { value: 'all', label: 'Clips for every slide' },
];

export const STILLS_LINE = 'Stills only: every slide uses its picture · 0 credits';

/** A slide's clip, in a few words: made and current, made from another picture, or why it wasn't made. */
export function clipMark(state: SceneState | undefined): string | null {
  if (!state) return null;
  if (clipIsCurrent(state)) return '🎬 clip ✓';
  if (state.clip) return 'picture changed — make again';
  return state.clipNote ?? null;
}

/** What Auto-pick did with a slide: "Auto-picked: <reason>", "Not auto-checked", or nothing (an owner's choice wins). */
export function autoMark(state: SceneState | undefined): string | null {
  if (!state || state.autoChecked !== true || choiceSourceOf(state) === 'owner') return null;
  if (choiceSourceOf(state) === 'auto') return state.autoReason ? `Auto-picked: ${state.autoReason}` : 'Auto-picked';
  return state.autoReason === NOT_AUTO_CHECKED || !state.autoReason ? 'Not auto-checked' : null;
}

/** Flow's credits left, when the last clip run read the balance: what it read less what it pressed Generate for since. */
export function creditsLeft(run: RunState | null): number | null {
  if (!run || !isClipRun(run) || typeof run.balance !== 'number') return null;
  return Math.max(0, run.balance - (run.spent ?? 0));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "3 clips · 21 credits needed · 86 credits left" (or "credits left: checked when you start"). */
export function estimateLine(project: Project, states: Record<string, SceneState>, run: RunState | null): string {
  if ((project.motionMode ?? 'stills') === 'stills' || project.aspect === '1:1') return STILLS_LINE;
  const { clips, credits } = estimate(project, states);
  const left = creditsLeft(run);
  return `${plural(clips, 'clip')} · ${plural(credits, 'credit')} needed · ${left === null ? 'credits left: checked when you start' : `${plural(left, 'credit')} left`}`;
}

/** This video's Motion or Auto-pick run (running, paused or finished), if the background's run is one. */
export function motionRunFor(project: Pick<Project, 'id'>, run: RunState | null): RunState | null {
  return run && run.projectId === project.id && (isClipRun(run) || isAutoPickRun(run)) ? run : null;
}

/** This video's Motion or Auto-pick run is going or paused. */
export function motionLive(project: Pick<Project, 'id'>, run: RunState | null): boolean {
  const mine = motionRunFor(project, run);
  return !!mine && (mine.status === 'running' || mine.status === 'paused');
}

/** A pause of a Motion or Auto-pick run the owner must act on (not one he asked for). */
export function motionPauseReason(project: Pick<Project, 'id'>, run: RunState | null): string | null {
  const mine = motionRunFor(project, run);
  if (!mine || mine.status !== 'paused' || !mine.pauseReason || mine.pauseReason === USER_PAUSE_REASON) return null;
  return mine.pauseReason;
}

/** The slide a paused Motion/Auto-pick run is about (Skip means it), as its slide number; null when there is none. */
export function pausedOnSlide(project: Pick<Project, 'id' | 'scenes'>, run: RunState | null): number | null {
  const mine = motionRunFor(project, run);
  if (!mine || mine.status !== 'paused' || !mine.pauseSceneId) return null;
  if (mine.sceneStates[mine.pauseSceneId]?.status !== 'pending') return null;
  return project.scenes.find((s) => s.id === mine.pauseSceneId)?.slide ?? null;
}

/** Counts of a Motion/Auto-pick run's slides. */
export function runCounts(run: RunState): { done: number; working: number; toGo: number; failed: number; total: number } {
  const all = Object.values(run.sceneStates);
  return {
    done: all.filter((s) => s.status === 'done').length,
    working: all.filter((s) => s.status === 'submitted').length,
    toGo: all.filter((s) => s.status === 'pending').length,
    failed: all.filter((s) => s.status === 'failed' || s.status === 'refused').length,
    total: all.length,
  };
}

/** The clip limit as typed: a whole number from 0 up to what the clips need (more is never asked for). */
export function clampLimit(typed: string, needed: number): number {
  const n = Math.floor(Number(typed));
  if (!Number.isFinite(n) || typed.trim() === '') return needed;
  return Math.max(0, Math.min(n, needed));
}

/** The picks in slide order, with `sceneId` on or off. */
export function togglePick(project: Pick<Project, 'scenes' | 'clipPicks'>, sceneId: string, on: boolean): string[] {
  const picks = new Set(project.clipPicks ?? []);
  if (on) picks.add(sceneId);
  else picks.delete(sceneId);
  return project.scenes.filter((s) => picks.has(s.id)).map((s) => s.id);
}

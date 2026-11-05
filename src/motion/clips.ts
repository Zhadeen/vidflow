import type { Project, SceneState } from '../store/projects';
import { chosenPicture } from '../studio/chosen';
import { CLIP_COST, clipLengthFor, slideSeconds } from './timing';

export type { ClipRecord } from './timing';

/** True when the scene's clip was made from the picture the scene now uses (a changed choice makes it stale). */
export function clipIsCurrent(state: SceneState | undefined): boolean {
  const pic = chosenPicture(state);
  return !!state?.clip && !!pic && state.clip.sourcePictureId === pic;
}

/** Scene ids that still need a clip, by the video's motion mode. Square (1:1) videos never get clips. */
export function scenesToClip(project: Project, states: Record<string, SceneState>): string[] {
  if (project.aspect === '1:1') return [];
  const mode = project.motionMode ?? 'stills';
  if (mode === 'stills') return [];
  const picks = new Set(project.clipPicks ?? []);
  return project.scenes
    .filter((s) => (mode === 'all' || picks.has(s.id)) && chosenPicture(states[s.id]) && !clipIsCurrent(states[s.id]))
    .map((s) => s.id);
}

export function estimate(project: Project, states: Record<string, SceneState>): { clips: number; credits: number } {
  const ids = new Set(scenesToClip(project, states));
  const scenes = project.scenes.filter((s) => ids.has(s.id));
  return { clips: scenes.length, credits: scenes.reduce((sum, s) => sum + CLIP_COST[clipLengthFor(slideSeconds(s))], 0) };
}

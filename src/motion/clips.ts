import type { Scene } from '../scenes/types';
import { defaultMotionPrompt } from '../scenes/motion';
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

/** Said after every clip's motion prompt (spec §20). */
export const CLIP_PROMPT_TAIL =
  'Keep the exact same drawing style and characters as the start frame; simple, gentle motion; no new objects, no text, no camera cuts.';

/** A slide's clip prompt: its Motion Prompt (else the default one from its picture prompt), then the fixed line. */
export function clipPrompt(scene: Scene): string {
  const motion = scene.motionPrompt.trim() || defaultMotionPrompt(scene.imagePrompt);
  return `${motion} ${CLIP_PROMPT_TAIL}`;
}

/** The start picture's asset name in Flow: vidflow-s<NN>.png, NN the slide's place in the video. */
export function startFrameName(project: Pick<Project, 'scenes'>, sceneId: string): string {
  const i = project.scenes.findIndex((s) => s.id === sceneId);
  return `vidflow-s${String(i + 1).padStart(2, '0')}.png`;
}

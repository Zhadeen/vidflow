import type { SceneState } from '../store/projects';

/**
 * The picture a scene uses: the owner's choice if it is still one of the scene's pictures, else Flow's first.
 * Pure (no store or chrome imports), so the scene grid and the side panel can use it without pulling in IndexedDB.
 */
export function chosenPicture(state: SceneState | undefined): string | undefined {
  if (!state) return undefined;
  const chosen = state.chosenPictureId;
  return chosen && state.pictureIds.includes(chosen) ? chosen : state.pictureIds[0];
}

/** True when the owner has chosen one of this scene's pictures (not just Flow's first by default). */
export function hasChoice(state: SceneState | undefined): boolean {
  return !!state?.chosenPictureId && state.pictureIds.includes(state.chosenPictureId);
}

/** Who made the scene's choice. A choice saved before Plan 3 has no source and counts as the owner's (the safe side). */
export function choiceSourceOf(state: SceneState | undefined): 'owner' | 'auto' | undefined {
  if (!hasChoice(state)) return undefined;
  return state?.choiceSource ?? 'owner';
}

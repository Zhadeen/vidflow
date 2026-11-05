import { getProject, saveProject, type Project } from '../store/projects';
import type { ProjectPatch } from './ScriptStep';

/** The studio's edit applied to a project. A new scene file starts the pictures again (old ones belong to old scenes). */
export function applyPatch(project: Project, patch: ProjectPatch): Project {
  const next = { ...project, ...patch };
  if (patch.scenes) next.sceneStates = {};
  return next;
}

/**
 * Saves only what the studio edits: re-reads the stored project first, so scene states the background saved meanwhile
 * are kept. Returns the saved project, or undefined when it is gone.
 */
export async function saveEdits(id: string, patch: ProjectPatch): Promise<Project | undefined> {
  const stored = await getProject(id);
  if (!stored) return undefined;
  const next = applyPatch(stored, patch);
  await saveProject(next);
  return next;
}

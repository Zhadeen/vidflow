import { updateProject, type Project } from '../store/projects';
import type { ProjectPatch } from './ScriptStep';

/** The studio's edit applied to a project. A new scene file starts the pictures again (old ones belong to old scenes). */
export function applyPatch(project: Project, patch: ProjectPatch): Project {
  const next = { ...project, ...patch };
  if (patch.scenes) {
    next.sceneStates = {};
    // New scenes reuse the old pictures' media ids: nothing of theirs is downloaded yet.
    delete next.downloaded;
  }
  return next;
}

/**
 * Saves only what the studio edits: the stored project is read and written in one transaction, so scene states the
 * background saved meanwhile (and pictures marked downloaded) are kept. Returns the saved project, or undefined when it
 * is gone.
 */
export function saveEdits(id: string, patch: ProjectPatch): Promise<Project | undefined> {
  return updateProject(id, (stored) => applyPatch(stored, patch));
}

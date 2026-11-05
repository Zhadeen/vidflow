import { NOT_THIS_SCENES_PICTURE } from '../runs/run';
import { getProject } from '../store/projects';
import { chromeRunClient, type RunClient } from './runClient';

export { chosenPicture, hasChoice } from './chosen';

/**
 * Saves the owner's choice (must be one of the scene's pictureIds); works while a run is live. The background is the
 * single writer: it puts the choice into a live run's state and the stored project. Rejects with the reason shown.
 */
export async function choosePicture(
  projectId: string,
  sceneId: string,
  pictureId: string,
  client: RunClient = chromeRunClient(),
): Promise<void> {
  const project = await getProject(projectId);
  if (!project?.sceneStates[sceneId]?.pictureIds.includes(pictureId)) throw new Error(NOT_THIS_SCENES_PICTURE);
  const reply = await client.choose(projectId, sceneId, pictureId);
  if (!reply.ok) throw new Error(reply.message);
}

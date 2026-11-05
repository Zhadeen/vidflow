/**
 * Build check: the real side panel (IndexedDB in the browser, a fake background and chrome.storage) so it can be
 * screenshotted next to docs/design/approved/side-panel.html. Run: node tests/visual/side-panel.mjs
 */
import { createRoot } from 'react-dom/client';
import type { RunReply } from '../../src/flow/messages';
import { Panel } from '../../src/panel/Panel';
import { initRun, reduceRun, type RunState } from '../../src/runs/run';
import { parseSceneFile } from '../../src/scenes/parse';
import { createProject, deleteProject, listProjects, saveProject, setMediaStore } from '../../src/store/projects';
import type { RunClient } from '../../src/studio/runClient';
import '../../src/studio/theme/studio.css';
import '../../src/panel/panel.css';

const REPLY = [
  'Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt',
  '"Slide 01","00:00 - 00:04","Every month my phone bill went up.","bill","£80","A stick figure stares at a long phone bill.","Looks down."',
  '"Slide 02","00:04 - 00:08","So I read every line.","read","","A stick figure reads with a magnifying glass.","Leans in."',
  '"Slide 03","00:08 - 00:12","I was paying for three old phones.","phones","3","Three old phones on a table.","Phones wobble."',
  '"Slide 04","00:12 - 00:16","I called and cancelled them.","call","","A stick figure on the phone, smiling.","Talks."',
  '"Slide 05","00:16 - 00:20","The bill halved.","half","£40","A bill torn in half.","Paper falls."',
  '"Slide 06","00:20 - 00:24","Check yours today.","check","","A stick figure points at the viewer.","Points."',
].join('\n');

const screen = new URLSearchParams(location.search).get('screen') ?? 'setup';
const id = (i: number) => `scene-${String(i).padStart(2, '0')}`;

async function main() {
  setMediaStore({ put: async () => '', get: async () => new Blob(), removeProject: async () => undefined });
  for (const p of await listProjects()) await deleteProject(p.id);
  const older = await createProject('Why cats knock things over');
  await saveProject(older);
  const project = await createProject('Phone Bill Story');
  project.character = null;
  if (screen === 'running') project.scenes = parseSceneFile(REPLY).scenes;
  await saveProject(project);

  let run: RunState | null = null;
  if (screen === 'running') {
    let s = reduceRun(initRun(project), { type: 'start' });
    for (let i = 1; i <= 2; i++) {
      s = reduceRun(s, { type: 'submitted', sceneId: id(i) });
      s = reduceRun(s, { type: 'pictures', sceneId: id(i), mediaIds: ['a', 'b'] });
    }
    s = reduceRun(s, { type: 'submitted', sceneId: id(3) });
    run = reduceRun(s, { type: 'submitted', sceneId: id(4) });
  }

  const today = new Date();
  const at = (h: number, m: number, sec: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, sec).getTime();
  const store: Record<string, unknown> = {
    'vidflow.step': { projectId: project.id, sceneId: id(3), text: 'Pressing Generate', target: 'generate', at: Date.now() },
    'vidflow.activity': [
      { at: at(10, 23, 58), projectId: project.id, sceneId: null, text: 'Opened a new Flow project' },
      { at: at(10, 24, 40), projectId: project.id, sceneId: id(1), text: '✓ Saved 2 pictures' },
      { at: at(10, 24, 44), projectId: project.id, sceneId: id(2), text: '✓ Saved 2 pictures' },
      { at: at(10, 24, 49), projectId: project.id, sceneId: id(3), text: 'Typing the prompt' },
      { at: at(10, 24, 51), projectId: project.id, sceneId: id(3), text: 'Pressing Generate' },
    ],
  };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { getURL: (p: string) => p },
    storage: {
      local: { get: async (key: string) => (key in store ? { [key]: store[key] } : {}), set: async () => undefined },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };

  const reply = async (): Promise<RunReply> => ({ ok: true, state: run });
  const client: RunClient = { get: reply, start: reply, pause: reply, resume: reply, retry: reply, stop: reply, forget: reply, choose: reply, subscribe: () => () => undefined };
  createRoot(document.getElementById('root')!).render(<Panel client={client} />);
  Object.assign(window, { REPLY, ready: true });
}

void main();

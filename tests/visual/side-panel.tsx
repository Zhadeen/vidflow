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
import type { CheckRow } from '../../src/runs/checks';
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

const ROWS: CheckRow[] = [
  { id: 'account', label: 'Google account', ok: true, detail: 'unscripted4ce@gmail.com' },
  { id: 'page', label: 'Flow page & project', ok: true, detail: 'Flow project open' },
  { id: 'promptBox', label: 'Prompt box', ok: true, detail: 'Found' },
  { id: 'generate', label: 'Generate button', ok: true, detail: 'Found' },
  { id: 'agentOff', label: 'Agent mode off', ok: true, detail: 'Off' },
  { id: 'settings', label: 'Flow settings', ok: true, detail: 'Nano Banana 2.1 · 16:9 · x2' },
  { id: 'hero', label: 'Hero reference', ok: true, detail: 'Reference picture ready · attached to every scene' },
  { id: 'credits', label: 'Credits', ok: true, detail: '1,043 credits · 0 needed for pictures' },
];

async function main() {
  const hero = await (await fetch('./stick1.jpg')).blob();
  const other = await (await fetch('./stick2.jpg')).blob();
  // Scene pictures alternate between the two sample drawings (option 2s use the other one).
  const get = async (key: string) => (/-2$|b$/.test(key) ? other : hero);
  setMediaStore({ put: async () => '', get, remove: async () => undefined, removeProject: async () => undefined });
  for (const p of await listProjects()) await deleteProject(p.id);
  const older = await createProject('Why cats knock things over');
  await saveProject(older);
  const project = await createProject('Phone Bill Story');
  project.script = 'Every month my phone bill went up. So I read every line.';
  project.character = { description: 'A short stickman with a red cap', referenceMediaId: `${project.id}/hero-reference` };
  if (screen === 'running' || screen === 'finished') project.scenes = parseSceneFile(REPLY).scenes;
  if (screen === 'finished') {
    // A finished video: five scenes saved (scene 2 with its second picture chosen), one Flow didn't finish.
    for (let i = 1; i <= 6; i++) {
      project.sceneStates[id(i)] =
        i === 4
          ? { sceneId: id(i), status: 'failed', message: "Flow didn't finish this picture in 10 minutes.", pictureIds: [] }
          : { sceneId: id(i), status: 'done', pictureIds: [`${id(i)}-1`, `${id(i)}-2`], cardKeys: [`k${i}a`, `k${i}b`], ...(i === 2 ? { chosenPictureId: `${id(i)}-2` } : {}) };
    }
  }
  await saveProject(project);

  let run: RunState | null = null;
  if (screen === 'running') {
    let s = reduceRun(initRun(project), { type: 'start' });
    for (let i = 1; i <= 2; i++) {
      s = reduceRun(s, { type: 'submitted', sceneId: id(i) });
      s = reduceRun(s, { type: 'pictures', sceneId: id(i), mediaIds: [`${id(i)}-a`, `${id(i)}-b`] });
    }
    s = reduceRun(s, { type: 'submitted', sceneId: id(3) });
    run = reduceRun(s, { type: 'submitted', sceneId: id(4) });
  }

  const today = new Date();
  const at = (h: number, m: number, sec: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, sec).getTime();
  const store: Record<string, unknown> = {
    'vidflow.step': { projectId: project.id, sceneId: id(3), text: 'Checking picture 2 of 2 matches its prompt', target: 'tile', at: Date.now() },
    'vidflow.activity': [
      { at: at(10, 23, 58), projectId: project.id, sceneId: null, text: 'Opened a new Flow project' },
      { at: at(10, 24, 40), projectId: project.id, sceneId: id(1), text: '✓ Saved 2 pictures' },
      { at: at(10, 24, 44), projectId: project.id, sceneId: id(2), text: '✓ Saved 2 pictures' },
      { at: at(10, 24, 49), projectId: project.id, sceneId: id(3), text: 'Typing the prompt' },
      { at: at(10, 24, 51), projectId: project.id, sceneId: id(3), text: 'Pressing Generate' },
      { at: at(10, 25, 12), projectId: project.id, sceneId: id(3), text: 'Checking picture 2 of 2 matches its prompt' },
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
  const client: RunClient = { get: reply, start: reply, pause: reply, resume: reply, retry: reply, stop: reply, skip: reply, forget: reply, choose: reply, heroSheet: reply, checks: async () => ({ ok: true, flowOpen: true, rows: ROWS }), openFlow: async () => ({ ok: true }), showMe: async () => ({ ok: true, missing: [] }), testPrompt: async () => ({ ok: true, message: 'Flow is ready.' }), subscribe: () => () => undefined };
  createRoot(document.getElementById('root')!).render(<Panel client={client} />);
  Object.assign(window, { REPLY, ready: true });
}

void main();

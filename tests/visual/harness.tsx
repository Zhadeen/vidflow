/**
 * Build check: renders the studio screens with fixture data (no extension APIs) so they can be screenshotted next to
 * the approved look. Run: node tests/visual/shoot.mjs
 */
import { createRoot } from 'react-dom/client';
import type { RunReply } from '../../src/flow/messages';
import { initRun, reduceRun, type RunState } from '../../src/runs/run';
import type { Scene } from '../../src/scenes/types';
import type { MediaStore } from '../../src/store/media';
import { setMediaStore, type Project } from '../../src/store/projects';
import { ProjectScreen } from '../../src/studio/ProjectScreen';
import { ProjectsHome } from '../../src/studio/ProjectsHome';
import type { RunClient } from '../../src/studio/runClient';
import '../../src/studio/theme/studio.css';

const SENTENCES = [
  'I opened my phone bill and nearly fell off my chair.',
  'So I switched everything off.',
  'The router, the TV, the lamp, even the kettle.',
  'Then I sat in the dark and waited.',
];

const id = (i: number) => `scene-${String(i).padStart(2, '0')}`;
const scenes: Scene[] = Array.from({ length: 60 }, (_, k) => ({
  id: id(k + 1),
  slide: k + 1,
  start: k * 4,
  end: k * 4 + 3 + (k % 3),
  sentence: SENTENCES[k % SENTENCES.length],
  concept: 'idea',
  textOverlay: '',
  imagePrompt: 'The hero does something.',
  motionPrompt: 'The hero moves.',
  motionPromptIsDefault: false,
}));

const project: Project = {
  id: 'p1',
  name: 'Phone Bill Story',
  createdAt: 0,
  updatedAt: Date.now(),
  script: SENTENCES.join(' '),
  scenes,
  style: 'stickman-whiteboard',
  character: { description: 'A tall stick figure with messy hair.' },
  aspect: '16:9',
  outputsPerPrompt: 2,
  sceneStates: {},
};

function runWith(done: number, extra: (s: RunState) => RunState = (s) => s): RunState {
  let s = reduceRun(initRun(project), { type: 'start' });
  for (let i = 1; i <= done; i++) {
    s = reduceRun(s, { type: 'submitted', sceneId: id(i) });
    s = reduceRun(s, { type: 'pictures', sceneId: id(i), mediaIds: ['stick1', 'stick2'] });
  }
  return extra(s);
}

// Fixture activity so the Pictures step's Activity list has something to show (no extension APIs here).
const T = Date.now();
(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) =>
        key === 'vidflow.activity'
          ? {
              [key]: [
                { at: T - 90000, projectId: 'p1', sceneId: null, text: 'Opened a new Flow project' },
                { at: T - 80000, projectId: 'p1', sceneId: id(1), text: 'Sent to Flow' },
                { at: T - 40000, projectId: 'p1', sceneId: id(1), text: '✓ Saved 2 pictures' },
                { at: T - 20000, projectId: 'p1', sceneId: id(2), text: 'Typing the prompt' },
                { at: T - 5000, projectId: 'p1', sceneId: id(2), text: 'Pressing Generate' },
                ...(screen === 'swap' ? [{ at: T - 1000, projectId: 'p1', sceneId: id(38), text: 'Swapped to picture 2' }] : []),
              ],
            }
          : {},
      set: async () => undefined,
    },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
};

const images: Record<string, Promise<Blob>> = {};
const media: MediaStore = {
  put: async () => '',
  get: (mediaId) => (images[mediaId] ??= fetch(`./${mediaId}.jpg`).then((r) => r.blob())),
  remove: async () => undefined,
  removeProject: async () => undefined,
};

const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
const client: RunClient = { get: ok, start: ok, pause: ok, resume: ok, retry: ok, stop: ok, skip: ok, forget: ok, choose: ok, heroSheet: ok, makeClips: ok, autoPick: ok, checks: async () => ({ ok: true, flowOpen: false, rows: [] }), openFlow: async () => ({ ok: true }), showMe: async () => ({ ok: true, missing: [] }), testPrompt: async () => ({ ok: true, message: 'Flow is ready.' }), subscribe: () => () => undefined };

const screen = new URLSearchParams(location.search).get('screen') ?? 'running';
const noop = () => undefined;

function view() {
  switch (screen) {
    case 'home':
      return (
        <div className="vf-shell">
          <header className="vf-header">
            <span className="vf-wordmark">〰 VidFlow</span>
          </header>
          <ProjectsHome
            projects={[
              { id: 'p1', name: 'Phone Bill Story', updatedAt: Date.now(), sceneCount: 60, doneCount: 38 },
              { id: 'p2', name: 'Why cats knock things over', updatedAt: Date.now() - 86400000 * 3, sceneCount: 24, doneCount: 24 },
              { id: 'p3', name: 'Untitled video', updatedAt: Date.now() - 86400000 * 9, sceneCount: 0, doneCount: 0 },
            ]}
            onCreate={noop}
            onOpen={noop}
            onDelete={noop}
          />
        </div>
      );
    case 'script':
      return <ProjectScreen project={project} run={null} client={client} media={media} initialStep="script" onChange={noop} onHome={noop} />;
    case 'script-hero':
      setMediaStore(media);
      return (
        <ProjectScreen
          project={{ ...project, character: { description: 'A tall stick figure with messy hair.', referenceMediaId: 'stick1' } }}
          run={null}
          client={client}
          media={media}
          initialStep="script"
          onChange={noop}
          onHome={noop}
        />
      );
    case 'script-model-sheet':
      setMediaStore(media);
      return (
        <ProjectScreen
          project={{
            ...project,
            character: { description: 'A tall stick figure with messy hair.', referenceMediaId: 'stick1' },
            heroSheet: { status: 'done', pictureIds: ['stick1', 'stick2'] },
          }}
          run={null}
          client={client}
          media={media}
          initialStep="script"
          onChange={noop}
          onHome={noop}
        />
      );
    case 'idle':
      return <ProjectScreen project={project} run={null} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    case 'paused': {
      const run = runWith(12, (s) =>
        reduceRun(s, {
          type: 'needsOwner',
          reason: 'wrong-account',
          message:
            'Flow is signed in to someone.else@gmail.com, but VidFlow is set to use unscripted4ce@gmail.com. Switch Flow to unscripted4ce@gmail.com, then press Resume.',
        }),
      );
      return <ProjectScreen project={project} run={run} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
    case 'finished': {
      let run = runWith(58);
      run = reduceRun(reduceRun(run, { type: 'submitted', sceneId: id(59) }), {
        type: 'refused',
        sceneId: id(59),
        message: "Flow didn't make this picture. It said the prompt may go against its policy.",
      });
      run = reduceRun(reduceRun(run, { type: 'submitted', sceneId: id(60) }), {
        type: 'failed',
        sceneId: id(60),
        message: "Flow didn't finish this picture in 10 minutes. Press Try again to send it again.",
      });
      const p = { ...project, sceneStates: run.sceneStates };
      return <ProjectScreen project={p} run={run} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
    case 'swap': {
      // The owner swapped scene 38 to its second picture during the run: pill and coral border on option 2.
      const run = runWith(38, (s) =>
        reduceRun(reduceRun(reduceRun(s, { type: 'choose', sceneId: id(38), pictureId: 'stick2' }), { type: 'submitted', sceneId: id(39) }), {
          type: 'submitted',
          sceneId: id(40),
        }),
      );
      return <ProjectScreen project={project} run={run} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
    case 'motion': {
      // Every slide has pictures; clips for the slides he picked: slide 1's made, slide 4's from an old picture, slide
      // 6's not made (the credit limit).
      const twelve = project.scenes.slice(0, 12);
      const sceneStates: Project['sceneStates'] = {};
      twelve.forEach((s, i) => (sceneStates[s.id] = { sceneId: s.id, status: 'done', pictureIds: i % 2 ? ['stick2', 'stick1'] : ['stick1', 'stick2'] }));
      const clip = (pic: string) => ({ mediaId: 'c', sourcePictureId: pic, length: 4, use: [0, 4] as [number, number] });
      sceneStates[id(1)] = { ...sceneStates[id(1)]!, clip: clip('stick1') };
      sceneStates[id(4)] = { ...sceneStates[id(4)]!, clip: clip('stick1') };
      sceneStates[id(6)] = { ...sceneStates[id(6)]!, clipNote: 'Not made — credit limit' };
      const p: Project = { ...project, scenes: twelve, sceneStates, motionMode: 'picked', clipPicks: [id(1), id(2), id(4), id(6), id(9)] };
      return <ProjectScreen project={p} run={null} client={client} media={media} initialStep="motion" onChange={noop} onHome={noop} />;
    }
    case 'autopick': {
      // Auto-pick chose scene 1's second picture: its reason under the chosen card.
      const one = project.scenes.slice(0, 1);
      const p: Project = {
        ...project,
        scenes: one,
        sceneStates: {
          [id(1)]: { sceneId: id(1), status: 'done', pictureIds: ['stick1', 'stick2'], chosenPictureId: 'stick2', choiceSource: 'auto', autoReason: 'shows the switched-off lamp', autoChecked: true },
        },
      };
      return <ProjectScreen project={p} run={null} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
    default: {
      const run = runWith(38, (s) => reduceRun(reduceRun(s, { type: 'submitted', sceneId: id(39) }), { type: 'submitted', sceneId: id(40) }));
      return <ProjectScreen project={project} run={run} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
  }
}

createRoot(document.getElementById('root')!).render(<div className="vf-page">{view()}</div>);

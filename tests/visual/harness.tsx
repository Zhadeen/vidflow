/**
 * Build check: renders the studio screens with fixture data (no extension APIs) so they can be screenshotted next to
 * the approved look. Run: node tests/visual/shoot.mjs
 */
import { createRoot } from 'react-dom/client';
import type { RunReply } from '../../src/flow/messages';
import { initRun, reduceRun, type RunState } from '../../src/runs/run';
import type { Scene } from '../../src/scenes/types';
import type { MediaStore } from '../../src/store/media';
import type { Project } from '../../src/store/projects';
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
  character: { description: 'A tall stick figure with messy hair.', hasReferenceImage: false },
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
  removeProject: async () => undefined,
};

const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
const client: RunClient = { get: ok, start: ok, pause: ok, resume: ok, retry: ok, stop: ok, forget: ok, choose: ok, subscribe: () => () => undefined };

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
    default: {
      const run = runWith(38, (s) => reduceRun(reduceRun(s, { type: 'submitted', sceneId: id(39) }), { type: 'submitted', sceneId: id(40) }));
      return <ProjectScreen project={project} run={run} client={client} media={media} initialStep="pictures" onChange={noop} onHome={noop} />;
    }
  }
}

createRoot(document.getElementById('root')!).render(<div className="vf-page">{view()}</div>);

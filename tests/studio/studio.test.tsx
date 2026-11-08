import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { checkCanStart } from '../../src/flow/driver';
import type { RunReply } from '../../src/flow/messages';
import { buildClaudePrompt } from '../../src/prompts/claude';
import { initRun, reduceRun, type RunState } from '../../src/runs/run';
import type { Scene } from '../../src/scenes/types';
import { memoryMediaStore } from '../../src/store/media';
import type { Project, SceneState } from '../../src/store/projects';
import { useState } from 'react';
import { applyPatch } from '../../src/studio/projectEdits';
import { ProjectsHome } from '../../src/studio/ProjectsHome';
import { ProjectScreen } from '../../src/studio/ProjectScreen';
import type { RunClient } from '../../src/studio/runClient';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sceneId = (i: number) => `scene-${String(i).padStart(2, '0')}`;

function scenes(n: number): Scene[] {
  return Array.from({ length: n }, (_, k) => ({
    id: sceneId(k + 1),
    slide: k + 1,
    start: k * 4,
    end: k * 4 + 4,
    sentence: `Sentence ${k + 1}.`,
    concept: 'idea',
    textOverlay: '',
    imagePrompt: `The hero does thing ${k + 1}`,
    motionPrompt: 'The hero moves.',
    motionPromptIsDefault: false,
  }));
}

function project(n = 60, sceneStates: Record<string, SceneState> = {}): Project {
  return {
    id: 'p1',
    name: 'Phone Bill Story',
    createdAt: 0,
    updatedAt: 0,
    scenes: scenes(n),
    style: 'stickman-whiteboard',
    character: null,
    aspect: '16:9',
    outputsPerPrompt: 2,
    sceneStates,
  };
}

/** A running run where the first `done` scenes have pictures. */
function runningState(p: Project, done: number): RunState {
  let s = reduceRun(initRun(p), { type: 'start' });
  for (let i = 1; i <= done; i++) {
    s = reduceRun(s, { type: 'submitted', sceneId: sceneId(i) });
    s = reduceRun(s, { type: 'pictures', sceneId: sceneId(i), mediaIds: [`p1/a${i}`, `p1/b${i}`] });
  }
  return s;
}

function fakeClient(over: Partial<RunClient> = {}): RunClient {
  const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
  return { get: ok, start: vi.fn(ok), pause: vi.fn(ok), resume: vi.fn(ok), retry: vi.fn(ok), stop: vi.fn(ok), skip: vi.fn(ok), forget: vi.fn(ok), choose: vi.fn(ok), heroSheet: vi.fn(ok), makeClips: vi.fn(ok), autoPick: vi.fn(ok), checks: vi.fn(async () => ({ ok: true as const, flowOpen: false, rows: [] })), openFlow: vi.fn(async () => ({ ok: true as const })), showMe: vi.fn(async () => ({ ok: true as const, missing: [] })), testPrompt: vi.fn(async () => ({ ok: true, message: 'Flow is ready.' })), subscribe: () => () => undefined, ...over };
}

function renderProject(p: Project, run: RunState | null, step: 'script' | 'pictures', client = fakeClient()) {
  return render(
    <ProjectScreen
      project={p}
      run={run}
      client={client}
      media={memoryMediaStore()}
      initialStep={step}
      onChange={() => undefined}
      onHome={() => undefined}
    />,
  );
}

/** ProjectScreen with a parent that keeps the project's edits, as the App does. */
function Harness({ start, run, client, onPatch }: { start: Project; run: RunState | null; client: RunClient; onPatch?: (p: unknown) => void }) {
  const [p, setP] = useState(start);
  return (
    <ProjectScreen
      project={p}
      run={run}
      client={client}
      media={memoryMediaStore()}
      initialStep="script"
      onChange={(patch) => {
        onPatch?.(patch);
        setP((cur) => applyPatch(cur, patch));
      }}
      onHome={() => undefined}
    />
  );
}

const REPLY_3 = [
  'Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt',
  '"Slide 01","00:00 - 00:04","One.","a","A","The hero waves.","Waves."',
  '"Slide 02","00:04 - 00:08","Two.","b","B","The hero sits.","Sits."',
  '"Slide 03","00:08 - 00:12","Three.","c","C","","Stands."',
].join('\n');

const primaries = (root: HTMLElement) => root.querySelectorAll('[data-variant="primary"]');

describe('studio', () => {
  it('each screen has exactly one primary button', () => {
    const home = render(
      <ProjectsHome
        projects={[{ id: 'p1', name: 'Phone Bill Story', updatedAt: Date.now(), sceneCount: 60, doneCount: 38 }]}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(primaries(home.container)).toHaveLength(1);
    cleanup();

    const script = renderProject(project(3), null, 'script');
    expect(primaries(script.container)).toHaveLength(1);
    cleanup();

    const idle = renderProject(project(60), null, 'pictures');
    expect(primaries(idle.container)).toHaveLength(1);
    cleanup();

    const p = project(60);
    const running = renderProject(p, runningState(p, 38), 'pictures');
    expect(primaries(running.container)).toHaveLength(1);
  });

  it('Copy Claude Prompt copies prompt with script', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const p = { ...project(0), script: '' };
    renderProject(p, null, 'script');
    const script = 'I opened my phone bill.\nIt was huge.';
    fireEvent.change(screen.getByLabelText(/your script/i), { target: { value: script } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Prompt' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildClaudePrompt(script)));
    expect(await screen.findByText(/paste it into claude\.ai/i)).toBeTruthy();
  });

  it('shows parse issues in plain words', () => {
    render(<Harness start={project(0)} run={null} client={fakeClient()} />);
    fireEvent.change(screen.getByLabelText(/claude's reply/i), { target: { value: REPLY_3 } });
    expect(screen.getByText('Scene 3 has no image prompt.')).toBeTruthy();
    const use = screen.getByRole('button', { name: 'Use these scenes' }) as HTMLButtonElement;
    expect(use.getAttribute('data-variant')).toBe('primary');
    expect(use.disabled).toBe(false);
    fireEvent.click(use);
    const next = screen.getByRole('button', { name: /continue to pictures/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
  });

  it('a pasted reply replaces scenes only on Use these scenes, and asks first when there are pictures', () => {
    const p = project(60);
    const run = runningState(p, 60);
    const patches: unknown[] = [];
    const { container } = render(<Harness start={{ ...p, sceneStates: run.sceneStates }} run={null} client={fakeClient()} onPatch={(x) => patches.push(x)} />);
    fireEvent.change(screen.getByLabelText(/claude's reply/i), { target: { value: REPLY_3 } });
    expect(patches.some((x) => 'scenes' in (x as object))).toBe(false);
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    expect(screen.getByText('This replaces 60 scenes and their pictures. Continue?')).toBeTruthy();
    expect(patches.some((x) => 'scenes' in (x as object))).toBe(false);
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace them' }));
    expect(patches.filter((x) => 'scenes' in (x as object))).toHaveLength(1);
  });

  it('the replace question says "1 scene" for a single scene', () => {
    const p = project(1);
    const run = runningState(p, 1);
    render(<Harness start={{ ...p, sceneStates: run.sceneStates }} run={null} client={fakeClient()} />);
    fireEvent.change(screen.getByLabelText(/claude's reply/i), { target: { value: REPLY_3 } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    expect(screen.getByText('This replaces 1 scene and its pictures. Continue?')).toBeTruthy();
  });

  it('after a finished run, a new scene file starts fresh: new count, no old pictures, no Try again', async () => {
    const p = project(60);
    let run = runningState(p, 59);
    run = reduceRun(reduceRun(run, { type: 'submitted', sceneId: 'scene-60' }), { type: 'refused', sceneId: 'scene-60', message: 'No.' });
    expect(run.status).toBe('finished');
    const client = fakeClient();
    render(<Harness start={{ ...p, sceneStates: run.sceneStates }} run={run} client={client} />);
    fireEvent.change(screen.getByLabelText(/claude's reply/i), { target: { value: REPLY_3 } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace them' }));
    await waitFor(() => expect(client.forget).toHaveBeenCalledWith('p1'));
    fireEvent.click(screen.getByRole('button', { name: /continue to pictures/i }));
    expect(screen.getByRole('button', { name: 'Start making pictures' }).getAttribute('data-variant')).toBe('primary');
    expect(screen.getByText(/3 scenes · 6 pictures/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /: Ready$/ })).toHaveLength(0);
    expect(within(screen.getByRole('navigation', { name: /steps/i })).getByText('Pictures 0/3')).toBeTruthy();
  });

  it('a paused run can be stopped from the studio', async () => {
    const p = project(4);
    const run = reduceRun(reduceRun(initRun(p), { type: 'start' }), { type: 'pause' });
    const client = fakeClient();
    renderProject(p, run, 'pictures', client);
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(stop);
    await waitFor(() => expect(client.stop).toHaveBeenCalled());
  });

  it('Continue to Motion stays coral and says Motion is coming next when pressed', () => {
    const p = project(60);
    renderProject(p, runningState(p, 38), 'pictures');
    const next = screen.getByRole('button', { name: /continue to motion/i }) as HTMLButtonElement;
    expect(next.getAttribute('data-variant')).toBe('primary');
    expect(next.disabled).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText(/Motion is coming next in VidFlow/)).toBeNull();
    fireEvent.click(next);
    expect(screen.getByText('Motion is coming next in VidFlow. Your pictures are saved in this project.')).toBeTruthy();
  });

  it('Pictures step shows live progress', () => {
    const p = project(60);
    renderProject(p, runningState(p, 38), 'pictures');
    const steps = screen.getByRole('navigation', { name: /steps/i });
    expect(within(steps).getByText('Pictures 38/60')).toBeTruthy();
  });

  it("refused scenes list Flow's reason with Try again", async () => {
    const p = project(3);
    let run = reduceRun(initRun(p), { type: 'start' });
    run = reduceRun(run, { type: 'submitted', sceneId: 'scene-02' });
    run = reduceRun(run, { type: 'refused', sceneId: 'scene-02', message: "This prompt might go against Google's policy." });
    const client = fakeClient();
    renderProject(p, run, 'pictures', client);
    const item = screen.getByText("This prompt might go against Google's policy.").closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.retry).toHaveBeenCalledWith('p1', 'scene-02'));
  });

  it('wrong account message is shown before starting', async () => {
    const { message } = checkCanStart(
      { ready: true, signedInEmail: 'someone.else@gmail.com', generating: false, limitMessage: null, noticeDialog: false, billingDialog: false, announcement: false },
      'unscripted4ce@gmail.com',
    ) as { message: string };
    const client = fakeClient({ start: vi.fn(async (): Promise<RunReply> => ({ ok: false, reason: 'wrong-account', message })) });
    renderProject(project(4), null, 'pictures', client);
    // Before starting, the owner is told what will happen.
    expect(screen.getByText(/0 Flow credits/)).toBeTruthy();
    expect(screen.getByText(/VidFlow started debugging this browser/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start making pictures/i }));
    });
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("shows the coordinator's pause reason word for word (e.g. wrong account found by the run)", () => {
    const p = project(4);
    const message = 'Flow is signed in to a@b.com, but VidFlow is set to use unscripted4ce@gmail.com. Switch Flow to unscripted4ce@gmail.com, then press Resume.';
    const run = reduceRun(reduceRun(initRun(p), { type: 'start' }), { type: 'needsOwner', reason: 'wrong-account', message });
    renderProject(p, run, 'pictures');
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' }).getAttribute('data-variant')).toBe('primary');
  });

  it('shows the finished summary with done, refused and failed counts', () => {
    const p = project(3);
    let run = reduceRun(initRun(p), { type: 'start' });
    for (const id of ['scene-01', 'scene-02', 'scene-03']) run = reduceRun(run, { type: 'submitted', sceneId: id });
    run = reduceRun(run, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['p1/a'] });
    run = reduceRun(run, { type: 'refused', sceneId: 'scene-02', message: 'No.' });
    run = reduceRun(run, { type: 'failed', sceneId: 'scene-03', message: 'Broke.' });
    // The coordinator saves the scene states into the project before it announces the change.
    renderProject({ ...p, sceneStates: run.sceneStates }, run, 'pictures');
    expect(screen.getByText(/1 done · 1 refused · 1 failed/)).toBeTruthy();
  });

  it('Voice, Motion, Edit and Export are not clickable and say Coming next', () => {
    renderProject(project(3), null, 'script');
    const steps = screen.getByRole('navigation', { name: /steps/i });
    for (const name of ['Voice', 'Motion', 'Edit', 'Export']) {
      expect(within(steps).queryByRole('button', { name: new RegExp(name) })).toBeNull();
    }
    expect(within(steps).getByText(/coming next/i)).toBeTruthy();
  });
});

describe('research prompts panel', () => {
  it('copies a research prompt and says so, without adding a second primary button', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = renderProject({ ...project(0), script: 'My script.' }, null, 'script');
    fireEvent.click(screen.getByRole('button', { name: 'Copy: titles and description' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Video Script Summary:\nMy script.')));
    expect(await screen.findByText(/paste it into gemini or claude\.ai/i)).toBeTruthy();
    expect(primaries(container)).toHaveLength(1);
  });
});

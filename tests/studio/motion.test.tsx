import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { RunReply } from '../../src/flow/messages';
import { NOT_AUTO_CHECKED } from '../../src/runs/autopick';
import { BALANCE_NOTE, initClipRun, initRun, reduceRun, type RunState } from '../../src/runs/run';
import type { Scene } from '../../src/scenes/types';
import { memoryMediaStore } from '../../src/store/media';
import type { Project, SceneState } from '../../src/store/projects';
import { applyPatch, SAVE_FAILED_MESSAGE } from '../../src/studio/projectEdits';
import { ProjectScreen } from '../../src/studio/ProjectScreen';
import type { RunClient } from '../../src/studio/runClient';
import type { ProjectPatch } from '../../src/studio/ScriptStep';

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

const done = (i: number, extra: Partial<SceneState> = {}): SceneState => ({
  sceneId: sceneId(i),
  status: 'done',
  pictureIds: [`p1/${i}-1`, `p1/${i}-2`],
  ...extra,
});
const clip = (picture: string) => ({ mediaId: `c/${picture}`, sourcePictureId: picture, length: 4, use: [0, 4] as [number, number] });

function project(n: number, edit: Partial<Project> = {}, states: Record<string, SceneState> = {}): Project {
  const sceneStates: Record<string, SceneState> = {};
  for (let i = 1; i <= n; i++) sceneStates[sceneId(i)] = done(i);
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
    sceneStates: { ...sceneStates, ...states },
    ...edit,
  };
}

function fakeClient(over: Partial<RunClient> = {}): RunClient {
  const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
  return { get: ok, start: vi.fn(ok), pause: vi.fn(ok), resume: vi.fn(ok), retry: vi.fn(ok), stop: vi.fn(ok), skip: vi.fn(ok), forget: vi.fn(ok), choose: vi.fn(ok), heroSheet: vi.fn(ok), makeClips: vi.fn(ok), autoPick: vi.fn(ok), checks: vi.fn(async () => ({ ok: true as const, flowOpen: false, rows: [] })), openFlow: vi.fn(async () => ({ ok: true as const })), showMe: vi.fn(async () => ({ ok: true as const, missing: [] })), testPrompt: vi.fn(async () => ({ ok: true, message: 'Flow is ready.' })), subscribe: () => () => undefined, ...over };
}

/** The studio screen with its edits applied, as App does. */
function Harness({
  start,
  run = null,
  client,
  step,
  onPatch,
  onFlush,
}: {
  start: Project;
  run?: RunState | null;
  client: RunClient;
  step: 'pictures' | 'motion';
  onPatch?(p: ProjectPatch): void;
  onFlush?(): Promise<unknown>;
}) {
  const [p, setP] = useState(start);
  return (
    <ProjectScreen
      project={p}
      run={run}
      client={client}
      media={memoryMediaStore()}
      initialStep={step}
      onChange={(patch) => {
        onPatch?.(patch);
        setP((now) => applyPatch(now, patch));
      }}
      onHome={() => undefined}
      onFlush={onFlush}
    />
  );
}

const primaries = () => [...document.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);
const tile = (n: number) => {
  const items = within(screen.getByRole('list', { name: 'Slides' })).getAllByRole('listitem');
  return items[n - 1]!;
};

describe('studio: Motion step', () => {
  it('Motion step (enabled, replaces "coming next"): same choice, grid with ticks and marks, estimate, Make clips', async () => {
    const client = fakeClient();
    const onPatch = vi.fn();
    const start = project(3, { motionMode: 'picked', clipPicks: [sceneId(2)] }, {
      [sceneId(1)]: done(1, { clip: clip('p1/1-1') }),
      [sceneId(3)]: done(3, { clipNote: BALANCE_NOTE }),
    });
    render(<Harness start={start} client={client} step="motion" onPatch={onPatch} />);

    const steps = screen.getByRole('navigation', { name: /steps/i });
    expect(within(steps).getByRole('button', { name: 'Motion' }).getAttribute('aria-current')).toBe('step');
    expect(within(steps).getByText('Voice, Edit and Export are coming next.')).toBeTruthy();

    const group = screen.getByRole('radiogroup', { name: 'Motion' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      'Stills only',
      'Clips for the slides I pick',
      'Clips for every slide',
    ]);
    expect((within(group).getByRole('radio', { name: 'Clips for the slides I pick' }) as HTMLInputElement).checked).toBe(true);

    expect(screen.getByText('1 clip · 7 credits needed · credits left: checked when you start')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: 'Credit limit for this run' }) as HTMLInputElement).value).toBe('7');

    // The grid: a Clip tick on each slide, and each slide's clip mark.
    expect(within(tile(1)).getByText('🎬 clip ✓')).toBeTruthy();
    expect(within(tile(3)).getByText('Not made — not enough Flow credits')).toBeTruthy();
    const tick = (n: number) => within(tile(n)).getByRole('checkbox', { name: `Clip for slide ${n}` }) as HTMLInputElement;
    expect([1, 2, 3].map((n) => tick(n).checked)).toEqual([false, true, false]);
    fireEvent.click(tick(3));
    expect(onPatch).toHaveBeenLastCalledWith({ clipPicks: [sceneId(2), sceneId(3)] });
    expect(await screen.findByText('2 clips · 14 credits needed · credits left: checked when you start')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pick none' }));
    expect(onPatch).toHaveBeenLastCalledWith({ clipPicks: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Pick all' }));
    expect(onPatch).toHaveBeenLastCalledWith({ clipPicks: [sceneId(1), sceneId(2), sceneId(3)] });
    // Slide 1's clip is up to date: picking all makes two.
    expect(await screen.findByText('2 clips · 14 credits needed · credits left: checked when you start')).toBeTruthy();

    fireEvent.click(within(group).getByRole('radio', { name: 'Clips for every slide' }));
    expect(onPatch).toHaveBeenLastCalledWith({ motionMode: 'all' });
    expect(screen.queryByRole('checkbox', { name: /Clip for slide/ })).toBeNull();

    // Exactly one coral: Make clips.
    expect(primaries()).toEqual(['Make clips (14 credits)']);
    fireEvent.click(screen.getByRole('button', { name: 'Make clips (14 credits)' }));
    await waitFor(() => expect(client.makeClips).toHaveBeenCalledWith('p1', 14));
  });

  it('Stills only: the coral waits and says why', () => {
    render(<Harness start={project(3)} client={fakeClient()} step="motion" />);
    const make = screen.getByRole('button', { name: /^Make clips/ }) as HTMLButtonElement;
    expect(primaries()).toEqual([make.textContent]);
    expect(make.disabled).toBe(true);
    expect(document.getElementById(make.getAttribute('aria-describedby')!)!.textContent).toMatch(/Choose clips above/);
  });

  it('while a clip run is live: progress, Pause coral, Stop, Skip slide N in the unsure pause', async () => {
    const p = project(3, { motionMode: 'all' });
    let run = reduceRun(initClipRun(p, [sceneId(1), sceneId(2), sceneId(3)], 21), { type: 'start' });
    run = reduceRun(run, { type: 'submitted', sceneId: sceneId(1) });
    const client = fakeClient();
    const view = render(<Harness start={p} run={run} client={client} step="motion" />);
    expect(screen.getByText(/Making clip 1 of 3/)).toBeTruthy();
    expect(primaries()).toEqual(['Pause']);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    view.unmount();

    const message = "VidFlow couldn't tell whether Flow started this clip. Check the Flow window, then press Resume — or Skip this slide.";
    const paused = reduceRun(run, { type: 'needsOwner', reason: 'page-not-recognised', message, sceneId: sceneId(2) });
    render(<Harness start={p} run={paused} client={client} step="motion" />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(primaries()).toEqual(['Resume']);
    fireEvent.click(screen.getByRole('button', { name: 'Skip slide 2' }));
    await waitFor(() => expect(client.skip).toHaveBeenCalled());
  });

  it('Continue to Motion → opens the Motion step', () => {
    render(<Harness start={project(3)} client={fakeClient()} step="pictures" />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Motion →' }));
    expect(screen.getByRole('radiogroup', { name: 'Motion' })).toBeTruthy();
  });
});

describe('studio: Pictures step · Auto-pick', () => {
  it('Pictures step shows the auto-pick reason under the chosen card', () => {
    const p = project(1, {}, { [sceneId(1)]: done(1, { chosenPictureId: 'p1/1-2', choiceSource: 'auto', autoReason: 'shows the shoulder bag', autoChecked: true }) });
    const view = render(<Harness start={p} client={fakeClient()} step="pictures" />);
    const chosen = document.querySelector<HTMLElement>('figure[data-best]')!;
    expect(chosen.textContent).toContain('★ Using this');
    expect(within(chosen).getByText('Auto-picked: shows the shoulder bag')).toBeTruthy();
    expect(primaries()).toEqual(['Continue to Motion →']);
    view.unmount();

    render(<Harness start={project(1, {}, { [sceneId(1)]: done(1, { autoReason: NOT_AUTO_CHECKED, autoChecked: true }) })} client={fakeClient()} step="pictures" />);
    expect(within(document.querySelector<HTMLElement>('figure[data-best]')!).getByText('Not auto-checked')).toBeTruthy();
  });

  it("an owner's own choice shows no auto-pick mark", () => {
    const p = project(1, {}, { [sceneId(1)]: done(1, { chosenPictureId: 'p1/1-2', choiceSource: 'owner', autoReason: 'old', autoChecked: true }) });
    render(<Harness start={p} client={fakeClient()} step="pictures" />);
    expect(document.querySelector('figure[data-best]')!.textContent).not.toMatch(/auto-picked|auto-checked/i);
  });
});

describe('studio: Motion review fixes', () => {
  it('a failed save stops Make clips and says so', async () => {
    const client = fakeClient();
    render(
      <Harness
        start={project(3, { motionMode: 'all' })}
        client={client}
        step="motion"
        onFlush={() => Promise.reject(new Error(SAVE_FAILED_MESSAGE))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make clips (21 credits)' }));
    expect(await screen.findByText(SAVE_FAILED_MESSAGE)).toBeTruthy();
    expect(client.makeClips).not.toHaveBeenCalled();
  });

  it('the credit limit re-clamps when the estimate drops and on blur; empty shows the estimate; 0 waits with a reason', async () => {
    render(<Harness start={project(3, { motionMode: 'picked', clipPicks: [sceneId(1), sceneId(2), sceneId(3)] })} client={fakeClient()} step="motion" />);
    const limit = screen.getByRole('spinbutton', { name: 'Credit limit for this run' }) as HTMLInputElement;
    expect(limit.value).toBe('21');
    fireEvent.change(limit, { target: { value: '' } });
    fireEvent.blur(limit);
    expect(limit.value).toBe('21');
    fireEvent.change(limit, { target: { value: '99' } });
    fireEvent.blur(limit);
    expect(limit.value).toBe('21');

    fireEvent.change(limit, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clip for slide 3' }));
    await waitFor(() => expect(limit.value).toBe('14'));

    fireEvent.change(limit, { target: { value: '0' } });
    const make = screen.getByRole('button', { name: 'Make clips (14 credits)' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    expect(document.getElementById(make.getAttribute('aria-describedby')!)!.textContent).toBe('Set a credit limit above 0.');
  });

  it('Continue to Motion waits, with the step bar\'s reason, while no slide has a picture', () => {
    const p = project(3, {}, { [sceneId(1)]: { sceneId: sceneId(1), status: 'pending', pictureIds: [] }, [sceneId(2)]: { sceneId: sceneId(2), status: 'pending', pictureIds: [] }, [sceneId(3)]: { sceneId: sceneId(3), status: 'pending', pictureIds: [] } });
    const run = reduceRun(reduceRun(initRun(p), { type: 'start' }), { type: 'submitted', sceneId: sceneId(1) });
    render(<Harness start={p} run={run} client={fakeClient()} step="pictures" />);
    const next = screen.getByRole('button', { name: 'Continue to Motion →' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    const steps = screen.getByRole('navigation', { name: /steps/i });
    const motion = within(steps).getByText('Motion');
    expect(motion.getAttribute('title')).toBe('Motion opens once a slide has its picture.');
    expect(document.getElementById(next.getAttribute('aria-describedby')!)!.textContent).toBe('Motion opens once a slide has its picture.');
  });
});

import { describe, expect, it } from 'vitest';
import { initRun, isLive, nextLocalMidnight, nextSceneToSubmit, normaliseEvent, reduceRun, runSummary, SKIPPED_MESSAGE, type RunEvent, type RunState } from '../../src/runs/run';
import type { Project, SceneState } from '../../src/store/projects';
import type { Scene } from '../../src/scenes/types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `scene-${String(i + 1).padStart(2, '0')}`);

function project(n: number, states: Record<string, SceneState> = {}): Project {
  const scenes = ids(n).map(
    (id, i) =>
      ({ id, slide: i + 1, start: null, end: null, sentence: '', concept: '', textOverlay: '', imagePrompt: 'p', motionPrompt: '', motionPromptIsDefault: true }) as Scene,
  );
  return {
    id: 'p1', name: 'P', createdAt: 0, updatedAt: 0, scenes, style: 'stickman-whiteboard',
    character: null, aspect: '16:9', outputsPerPrompt: 2, sceneStates: states,
  };
}

function apply(state: RunState, ...events: RunEvent[]): RunState {
  return events.reduce(reduceRun, state);
}

/** Submit the next scene (as the coordinator would) until the window is full. */
function fill(state: RunState, order: string[], max: number): RunState {
  let s = state;
  for (;;) {
    const next = nextSceneToSubmit(s, order, max);
    if (!next) return s;
    s = reduceRun(s, { type: 'submitted', sceneId: next });
  }
}

describe('run state machine', () => {
  it('submits scenes in order up to maxInFlight', () => {
    const order = ids(5);
    let s = apply(initRun(project(5)), { type: 'start' });
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-01');
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-01' });
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-02');
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-02' });
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-03');
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-03' });
    expect(nextSceneToSubmit(s, order, 3)).toBeNull();
    s = reduceRun(s, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['a', 'b'] });
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'done', pictureIds: ['a', 'b'] });
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-04');
  });

  it('refusal marks scene and advances', () => {
    const order = ids(5);
    let s = fill(apply(initRun(project(5)), { type: 'start' }), order, 3);
    s = reduceRun(s, { type: 'refused', sceneId: 'scene-02', message: 'Flow refused this prompt' });
    expect(s.sceneStates['scene-02']).toMatchObject({ status: 'refused', message: 'Flow refused this prompt' });
    expect(s.inFlight).toEqual(['scene-01', 'scene-03']);
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-04');
  });

  it('limit pauses with resumeAt', () => {
    const T = 1_800_000_000_000;
    const s = apply(initRun(project(3)), { type: 'start' }, { type: 'limit', message: 'Daily limit reached', resumeAt: T });
    expect(s.status).toBe('paused');
    expect(s.resumeAt).toBe(T);
    expect(nextSceneToSubmit(s, ids(3), 3)).toBeNull();
  });

  it('needsOwner pauses with plain reason', () => {
    const s = apply(initRun(project(3)), { type: 'start' }, {
      type: 'needsOwner', reason: 'policy-dialog', message: 'Flow is asking you to accept its terms.',
    });
    expect(s.status).toBe('paused');
    expect(s.pauseReason).toBe('Flow is asking you to accept its terms.');
  });

  it('restores persisted run and resumes at first unfinished', () => {
    const order = ids(8);
    const states: Record<string, SceneState> = {};
    for (const id of order.slice(0, 5)) states[id] = { sceneId: id, status: 'done', pictureIds: ['x'] };
    states['scene-06'] = { sceneId: 'scene-06', status: 'submitted', pictureIds: [] };
    const stale: RunState = {
      projectId: 'p1', status: 'running', inFlight: ['scene-06'],
      sceneStates: initRun(project(8, states)).sceneStates,
    };
    stale.sceneStates['scene-06'] = states['scene-06'];
    const restored = JSON.parse(JSON.stringify(stale)) as RunState;
    const restoredRun = reduceRun(restored, { type: 'restore' });
    expect(restoredRun.inFlight).toEqual([]);
    expect(restoredRun.sceneStates['scene-06'].status).toBe('pending');
    const s = reduceRun(restoredRun, { type: 'resume' });
    expect(s.status).toBe('running');
    expect(nextSceneToSubmit(s, order, 3)).toBe('scene-06');
    // a late pictures event for the stale scene is ignored
    const late = reduceRun(s, { type: 'pictures', sceneId: 'scene-06', mediaIds: ['z'] });
    expect(late.sceneStates['scene-06'].status).toBe('pending');
  });

  it('finishes when nothing pending or in flight', () => {
    const order = ids(3);
    let s = fill(apply(initRun(project(3)), { type: 'start' }), order, 3);
    s = apply(
      s,
      { type: 'pictures', sceneId: 'scene-01', mediaIds: ['a'] },
      { type: 'refused', sceneId: 'scene-02', message: 'no' },
    );
    expect(s.status).toBe('running');
    s = reduceRun(s, { type: 'failed', sceneId: 'scene-03', message: 'timed out' });
    expect(s.status).toBe('finished');
    expect(runSummary(s)).toEqual({ done: 1, refused: ['scene-02'], failed: ['scene-03'], pending: 0 });
  });

  it('resume while running does not requeue in-flight scenes', () => {
    const order = ids(5);
    const running = fill(apply(initRun(project(5)), { type: 'start' }), order, 3);
    const s = reduceRun(running, { type: 'resume' });
    expect(s).toEqual(running);
    expect(s.inFlight).toEqual(['scene-01', 'scene-02', 'scene-03']);
  });

  it('resume after a user pause keeps in-flight scenes in flight', () => {
    const order = ids(5);
    let s = fill(apply(initRun(project(5)), { type: 'start' }), order, 3);
    s = apply(s, { type: 'pause' });
    expect(s.status).toBe('paused');
    s = reduceRun(s, { type: 'resume' });
    expect(s.status).toBe('running');
    expect(s.inFlight).toEqual(['scene-01', 'scene-02', 'scene-03']);
    expect(s.sceneStates['scene-02'].status).toBe('submitted');
    expect(s.pauseReason).toBeUndefined();
  });

  it('restore resets submitted scenes but keeps the status', () => {
    const order = ids(4);
    const s = reduceRun(apply(fill(apply(initRun(project(4)), { type: 'start' }), order, 2), { type: 'pause' }), { type: 'restore' });
    expect(s.status).toBe('paused');
    expect(s.inFlight).toEqual([]);
    expect(runSummary(s).pending).toBe(4);
  });
});

describe('limit helpers', () => {
  it('nextLocalMidnight is the next 00:00 local time', () => {
    const now = new Date(2026, 10, 5, 15, 30, 0).getTime();
    const m = new Date(nextLocalMidnight(now));
    expect([m.getFullYear(), m.getMonth(), m.getDate(), m.getHours(), m.getMinutes()]).toEqual([2026, 10, 6, 0, 0]);
    const atMidnight = new Date(2026, 10, 5, 0, 0, 0).getTime();
    expect(new Date(nextLocalMidnight(atMidnight)).getDate()).toBe(6);
  });

  it('a limit without resumeAt falls back to midnight and says when', () => {
    const now = new Date(2026, 10, 5, 15, 30, 0).getTime();
    const e = normaliseEvent({ type: 'limit', message: 'x', resumeAt: null }, now);
    expect(e).toEqual({ type: 'limit', message: "Flow's daily limit was reached. VidFlow will carry on at 00:00.", resumeAt: nextLocalMidnight(now) });
    const t = new Date(2026, 10, 5, 18, 5, 0).getTime();
    const e2 = normaliseEvent({ type: 'limit', message: 'x', resumeAt: t }, now);
    expect(e2).toMatchObject({ resumeAt: t, message: "Flow's daily limit was reached. VidFlow will carry on at 18:05." });
    expect(normaliseEvent({ type: 'pause' }, now)).toEqual({ type: 'pause' });
  });
});

describe('result matching state', () => {
  it('numbers submissions in order and keeps the submitted prompt', () => {
    let s = apply(initRun(project(3)), { type: 'start' });
    s = apply(s, { type: 'submitted', sceneId: 'scene-02', prompt: 'P2', at: 10 }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 20 });
    expect(s.sceneStates['scene-02']!.submission).toEqual({ seq: 1, at: 10, prompt: 'P2' });
    expect(s.sceneStates['scene-01']!.submission).toEqual({ seq: 2, at: 20, prompt: 'P1' });
  });

  it('records an unconfirmed start on the still-pending scene, and clears it once submitted', () => {
    let s = apply(initRun(project(2)), { type: 'start' });
    s = reduceRun(s, { type: 'unconfirmed', sceneId: 'scene-01', keysBefore: ['k1'], prompt: 'P1' });
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'pending', unconfirmed: { keysBefore: ['k1'], prompt: 'P1' } });
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 });
    expect(s.sceneStates['scene-01']!.unconfirmed).toBeUndefined();
  });

  it("keeps detail prompts and the scene's Flow card keys", () => {
    let s = apply(initRun(project(1)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 });
    s = reduceRun(s, { type: 'detail', cardKey: 'k1', prompt: 'P1' });
    expect(s.detailPrompts).toEqual({ k1: 'P1' });
    s = reduceRun(s, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m1'], cardKeys: ['k1'] });
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'done', pictureIds: ['m1'], cardKeys: ['k1'] });
  });

  it('a requeued scene loses its old submission number', () => {
    let s = apply(initRun(project(1)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 });
    s = reduceRun(s, { type: 'restore' });
    expect(s.sceneStates['scene-01']!.submission).toBeUndefined();
  });
});

it('new pictures clear an earlier best-picture choice', () => {
  let s = apply(initRun(project(1)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 });
  s = { ...s, sceneStates: { 'scene-01': { ...s.sceneStates['scene-01']!, chosenPictureId: 'old' } } };
  s = reduceRun(s, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m1'], cardKeys: ['k1'] });
  expect(s.sceneStates['scene-01']!.chosenPictureId).toBeUndefined();
});

describe('Try again (retry)', () => {
  it('puts a refused scene back in the queue and carries on a finished run', () => {
    let s = apply(initRun(project(2)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01' }, { type: 'submitted', sceneId: 'scene-02' });
    s = apply(s, { type: 'refused', sceneId: 'scene-01', message: 'Flow said no.' }, { type: 'pictures', sceneId: 'scene-02', mediaIds: ['m'] });
    expect(s.status).toBe('finished');
    s = reduceRun(s, { type: 'retry', sceneId: 'scene-01' });
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'pending' });
    expect(s.sceneStates['scene-01']!.message).toBeUndefined();
    expect(s.status).toBe('running');
    expect(nextSceneToSubmit(s, ids(2), 2)).toBe('scene-01');
  });

  it('re-queues a failed scene but leaves a paused run paused', () => {
    let s = apply(initRun(project(2)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01' });
    s = apply(s, { type: 'failed', sceneId: 'scene-01', message: 'x' }, { type: 'pause' });
    s = reduceRun(s, { type: 'retry', sceneId: 'scene-01' });
    expect(s.sceneStates['scene-01']!.status).toBe('pending');
    expect(s.status).toBe('paused');
  });

  it('ignores a scene that is not refused or failed', () => {
    const s = apply(initRun(project(1)), { type: 'start' });
    expect(reduceRun(s, { type: 'retry', sceneId: 'scene-01' })).toBe(s);
  });

  it('a finished or idle run cannot be paused', () => {
    const idle = initRun(project(1));
    expect(reduceRun(idle, { type: 'pause' })).toBe(idle);
    let done = apply(idle, { type: 'start' }, { type: 'submitted', sceneId: 'scene-01' }, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m'] });
    expect(done.status).toBe('finished');
    expect(reduceRun(done, { type: 'pause' })).toBe(done);
    done = apply(apply(initRun(project(1)), { type: 'start' }), { type: 'pause' });
    expect(done.status).toBe('paused');
  });

  it('records when a scene became unconfirmed', () => {
    const s = apply(initRun(project(1)), { type: 'start' }, { type: 'unconfirmed', sceneId: 'scene-01', keysBefore: ['a'], prompt: 'p', at: 1234 });
    expect(s.sceneStates['scene-01']!.unconfirmed).toEqual({ keysBefore: ['a'], prompt: 'p', at: 1234 });
  });

  it('resume and start restart the unconfirmed clock (only running time counts)', () => {
    let s = apply(initRun(project(1)), { type: 'start' }, { type: 'unconfirmed', sceneId: 'scene-01', keysBefore: [], prompt: 'p', at: 1 });
    s = reduceRun(s, { type: 'pause' });
    expect(s.sceneStates['scene-01']!.unconfirmed!.at).toBe(1);
    const before = Date.now();
    const resumed = reduceRun(s, { type: 'resume' });
    expect(resumed.sceneStates['scene-01']!.unconfirmed!.at).toBeGreaterThanOrEqual(before);
    const started = reduceRun(s, { type: 'start' });
    expect(started.sceneStates['scene-01']!.unconfirmed!.at).toBeGreaterThanOrEqual(before);
  });
});

describe('Skip (spec §19)', () => {
  it('ends a scene in Flow as failed "Skipped by you", keeps its submission so its late pictures are never matched, and moves on', () => {
    let s = apply(
      initRun(project(3)),
      { type: 'start' },
      { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 5 },
      { type: 'submitted', sceneId: 'scene-02', prompt: 'P2', at: 6 },
    );
    s = reduceRun(s, { type: 'skip', sceneId: 'scene-01' });
    expect(SKIPPED_MESSAGE).toBe('Skipped by you');
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'failed', message: 'Skipped by you' });
    expect(s.sceneStates['scene-01']!.submission).toBeUndefined();
    expect(s.inFlight).toEqual(['scene-02']);
    expect(s.skippedPrompts).toEqual([{ sceneId: 'scene-01', prompt: 'P1', seq: 1, at: 5 }]);
    expect(s.status).toBe('running');
    expect(nextSceneToSubmit(s, ids(3), 3)).toBe('scene-03');

    // Its pictures arriving later are stale; a refusal or failure for it doesn't replace "Skipped by you".
    const after = apply(s, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m'] }, { type: 'refused', sceneId: 'scene-01', message: 'no' });
    expect(after.sceneStates['scene-01']).toMatchObject({ status: 'failed', message: 'Skipped by you', pictureIds: [] });
  });

  it('skips a scene still waiting its turn without recording a prompt, and finishes the run when it was the last', () => {
    let s = apply(initRun(project(1)), { type: 'start' });
    s = reduceRun(s, { type: 'skip', sceneId: 'scene-01' });
    expect(s.sceneStates['scene-01']).toMatchObject({ status: 'failed', message: SKIPPED_MESSAGE });
    expect(s.skippedPrompts ?? []).toEqual([]);
    expect(s.status).toBe('finished');
    expect(isLive(s)).toBe(false);
  });

  it('a Generate press confirmed after the skip still takes its place in the order, never the scene', () => {
    let s = apply(initRun(project(2)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 });
    s = reduceRun(s, { type: 'skip', sceneId: 'scene-02' }); // skipped while being typed
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-02', prompt: 'P2', at: 2 });
    expect(s.sceneStates['scene-02']).toMatchObject({ status: 'failed', message: SKIPPED_MESSAGE });
    expect(s.inFlight).toEqual(['scene-01']);
    expect(s.skippedPrompts).toEqual([{ sceneId: 'scene-02', prompt: 'P2', seq: 2, at: 2 }]);
  });

  it('ignores a scene that is done, refused or failed already, or not in the run', () => {
    let s = apply(initRun(project(2)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01' }, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m'] });
    expect(reduceRun(s, { type: 'skip', sceneId: 'scene-01' })).toBe(s);
    expect(reduceRun(s, { type: 'skip', sceneId: 'nope' })).toBe(s);
    s = apply(s, { type: 'submitted', sceneId: 'scene-02' }, { type: 'failed', sceneId: 'scene-02', message: 'x' });
    expect(reduceRun(s, { type: 'skip', sceneId: 'scene-02' })).toBe(s);
  });

  it('Try again on a skipped scene queues it again; its old submission keeps its place', () => {
    let s = apply(initRun(project(1)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 1 }, { type: 'skip', sceneId: 'scene-01' });
    s = reduceRun(s, { type: 'retry', sceneId: 'scene-01' });
    expect(s.sceneStates['scene-01']!.status).toBe('pending');
    expect(s.skippedPrompts).toHaveLength(1);
    s = reduceRun(s, { type: 'submitted', sceneId: 'scene-01', prompt: 'P1', at: 3 });
    expect(s.sceneStates['scene-01']!.submission).toMatchObject({ seq: 2 });
  });
});

describe('which pictures have the hero (Queue "hero ✓")', () => {
  it('records on the scene whether its pictures were made with the hero reference attached', () => {
    let s = apply(initRun(project(2)), { type: 'start' }, { type: 'submitted', sceneId: 'scene-01' }, { type: 'submitted', sceneId: 'scene-02' });
    s = apply(s, { type: 'pictures', sceneId: 'scene-01', mediaIds: ['m'], withHero: true }, { type: 'pictures', sceneId: 'scene-02', mediaIds: ['n'] });
    expect(s.sceneStates['scene-01']!.withHero).toBe(true);
    expect(s.sceneStates['scene-02']!.withHero).toBe(false);
  });
});

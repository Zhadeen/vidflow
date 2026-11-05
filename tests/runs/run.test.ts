import { describe, expect, it } from 'vitest';
import { initRun, nextSceneToSubmit, reduceRun, runSummary, type RunEvent, type RunState } from '../../src/runs/run';
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
    const s = reduceRun(restored, { type: 'resume' });
    expect(s.status).toBe('running');
    expect(s.inFlight).toEqual([]);
    expect(s.sceneStates['scene-06'].status).toBe('pending');
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
});

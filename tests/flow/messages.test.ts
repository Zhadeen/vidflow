import { describe, expect, it } from 'vitest';
import { flowTabEvent } from '../../src/flow/messages';

describe('events from the Flow tab', () => {
  it('accepts only the page-level events (limit, needs-owner)', () => {
    const limit = { type: 'limit', message: 'quota', resumeAt: null };
    const owner = { type: 'needsOwner', reason: 'policy-dialog', message: 'Read it.' };
    expect(flowTabEvent(limit)).toEqual(limit);
    expect(flowTabEvent(owner)).toEqual(owner);
    for (const bad of [
      { type: 'refused', sceneId: 's1', message: 'x' },
      { type: 'failed', sceneId: 's1', message: 'x' },
      { type: 'pictures', sceneId: 's1', mediaIds: ['m'] },
      { type: 'stop' },
      { type: 'start' },
      { type: 'resume' },
      null,
      'limit',
    ]) {
      expect(flowTabEvent(bad)).toBeNull();
    }
  });
});

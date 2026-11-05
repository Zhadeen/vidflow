import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_KEY,
  ACTIVITY_MAX,
  logActivity,
  readActivity,
  setStep,
  STEP_KEY,
  stepLine,
  type ActivityEntry,
} from '../../src/runs/activity';

const data: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          await Promise.resolve(); // a real read yields, so unserialized writers would interleave
          return key in data ? { [key]: structuredClone(data[key]) } : {};
        }),
        set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items))),
        remove: vi.fn(async (key: string) => void delete data[key]),
      },
    },
  });
});

const entry = (n: number, projectId = 'p1'): ActivityEntry => ({ at: n, projectId, sceneId: 's1', text: `t${n}` });

describe('activity log', () => {
  it('stepLine formats with and without a scene', () => {
    expect(stepLine(3, 'Pressing Generate')).toBe('Scene 3 · Pressing Generate');
    expect(stepLine(null, 'Set Flow to Image')).toBe('Set Flow to Image');
  });

  it('keeps only the newest 300 entries', async () => {
    for (let i = 0; i < ACTIVITY_MAX + 5; i++) await logActivity(entry(i));
    const saved = data[ACTIVITY_KEY] as ActivityEntry[];
    expect(saved).toHaveLength(ACTIVITY_MAX);
    expect(saved[0]!.at).toBe(5);
    expect(saved.at(-1)!.at).toBe(ACTIVITY_MAX + 4);
  });

  it('readActivity returns newest first for one project only', async () => {
    await logActivity(entry(1));
    await logActivity(entry(2, 'other'));
    await logActivity(entry(3));
    expect((await readActivity('p1')).map((e) => e.at)).toEqual([3, 1]);
    expect((await readActivity('p1', 1)).map((e) => e.at)).toEqual([3]);
  });

  it('concurrent logActivity calls lose nothing', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => logActivity(entry(i))));
    expect(await readActivity('p1')).toHaveLength(20);
  });

  it('setStep writes the step and null clears it', async () => {
    await setStep({ projectId: 'p1', sceneId: null, text: 'x', target: null, at: 1 });
    expect((data[STEP_KEY] as { text: string }).text).toBe('x');
    await setStep(null);
    expect(STEP_KEY in data).toBe(false);
  });
});

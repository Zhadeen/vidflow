import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ACTIVITY_KEY, type ActivityEntry } from '../../src/runs/activity';
import { LIVE_ACTIVITY_KEY } from '../../src/settings';
import { ActivityList } from '../../src/studio/ActivityList';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
let data: Record<string, unknown>;
let listeners: Set<Listener>;

beforeEach(() => {
  data = {};
  listeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items))),
      },
      onChanged: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (h: number, m: number, s: number) => new Date(2026, 10, 5, h, m, s).getTime();
const entry = (time: number, text: string, sceneId: string | null = null, projectId = 'p1'): ActivityEntry => ({ at: time, projectId, sceneId, text });
const project = { scenes: [{ id: 'a', slide: 1 }, { id: 'b', slide: 2 }, { id: 'c', slide: 3 }] } as never;

describe('ActivityList', () => {
  it('shows entries newest first with time and scene', async () => {
    data[ACTIVITY_KEY] = [
      entry(at(10, 23, 58), 'Opened a new Flow project'),
      entry(at(10, 24, 12), 'Other project', 'a', 'p2'),
      entry(at(10, 24, 40), '✓ Saved 2 pictures', 'a'),
      entry(at(10, 24, 49), 'Typing the prompt', 'c'),
    ];
    render(<ActivityList projectId="p1" project={project} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '10:24:49Scene 3 · Typing the prompt',
      '10:24:40Scene 1 · ✓ Saved 2 pictures',
      '10:23:58Opened a new Flow project',
    ]);
  });

  it('shows the newest 50 when no limit is given', async () => {
    data[ACTIVITY_KEY] = Array.from({ length: 80 }, (_, i) => entry(at(10, 0, 0) + i * 1000, `line ${i}`));
    render(<ActivityList projectId="p1" />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('line 79')).toBeTruthy();
    expect(screen.queryByText('line 29')).toBeNull();
  });

  it('updates when a new entry arrives', async () => {
    data[ACTIVITY_KEY] = [entry(at(10, 0, 1), 'First')];
    render(<ActivityList projectId="p1" />);
    await screen.findByText('First');
    const next = [...(data[ACTIVITY_KEY] as ActivityEntry[]), entry(at(10, 0, 9), 'Second')];
    data[ACTIVITY_KEY] = next;
    act(() => listeners.forEach((l) => l({ [ACTIVITY_KEY]: { newValue: next } }, 'local')));
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('Second'));
  });

  it('stops listening when it unmounts', async () => {
    render(<ActivityList projectId="p1" />);
    await screen.findByRole('switch');
    expect(listeners.size).toBe(1);
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it('the switch turns live activity off and on', async () => {
    render(<ActivityList projectId="p1" />);
    const sw = await screen.findByRole('switch', { name: 'Show live activity in Flow' });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    expect(data[LIVE_ACTIVITY_KEY]).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(data[LIVE_ACTIVITY_KEY]).toBe(true);
  });

  it('empty state reads "Nothing yet — press Start to begin."', async () => {
    render(<ActivityList projectId="p1" />);
    expect(await screen.findByText('Nothing yet — press Start to begin.')).toBeTruthy();
    expect(within(document.body).queryAllByRole('listitem')).toHaveLength(0);
  });
});

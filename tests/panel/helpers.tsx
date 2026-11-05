import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import type { RunReply } from '../../src/flow/messages';
import { initRun, reduceRun, type RunState } from '../../src/runs/run';
import type { Scene } from '../../src/scenes/types';
import { memoryMediaStore } from '../../src/store/media';
import { createProject, deleteProject, listProjects, saveProject, setMediaStore, type Project } from '../../src/store/projects';
import type { RunClient } from '../../src/studio/runClient';
import { fakeDownloads } from '../files/fakeDownloads';

export const STUDIO = 'chrome-extension://vidflow/studio.html';
export const sceneId = (i: number) => `scene-${String(i).padStart(2, '0')}`;

export function scenes(n: number): Scene[] {
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

export const REPLY_6 = [
  'Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt',
  ...Array.from({ length: 6 }, (_, k) => `"Slide 0${k + 1}","00:0${k} - 00:0${k + 1}","Line ${k + 1}.","c","T","The hero does ${k + 1}.","Moves."`),
].join('\n');

/** A stored project (newest last: each one saved after the previous). */
export async function seed(name: string, n = 0, edit: (p: Project) => void = () => undefined): Promise<Project> {
  const p = await createProject(name);
  p.scenes = scenes(n);
  edit(p);
  await new Promise((r) => setTimeout(r, 3));
  await saveProject(p);
  return p;
}

export async function clearProjects(): Promise<void> {
  setMediaStore(memoryMediaStore());
  for (const p of await listProjects()) await deleteProject(p.id);
}

/** A running run where the first `done` scenes have pictures and the next `drawing` are with Flow. */
export function runningState(p: Project, done: number, drawing = 0): RunState {
  let s = reduceRun(initRun(p), { type: 'start' });
  for (let i = 1; i <= done; i++) {
    s = reduceRun(s, { type: 'submitted', sceneId: sceneId(i) });
    s = reduceRun(s, { type: 'pictures', sceneId: sceneId(i), mediaIds: [`a${i}`, `b${i}`] });
  }
  for (let i = done + 1; i <= done + drawing; i++) s = reduceRun(s, { type: 'submitted', sceneId: sceneId(i) });
  return s;
}

/**
 * Run clients that share one background, as the studio and the panel do: a request changes the run, and every
 * subscriber hears the change (the background's run/state broadcast).
 */
export function fakeBackground(initial: RunState | null) {
  let state = initial;
  const listeners = new Set<(s: RunState) => void>();
  const announce = (next: RunState | null): RunReply => {
    state = next;
    if (next) for (const l of listeners) l(next);
    return { ok: true, state };
  };
  const client = (): RunClient => ({
    get: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    start: vi.fn(async (projectId: string) => announce({ ...(state ?? { inFlight: [], sceneStates: {} }), projectId, status: 'running' } as RunState)),
    pause: vi.fn(async () => announce(state && reduceRun(state, { type: 'pause' }))),
    resume: vi.fn(async () => announce(state && reduceRun(state, { type: 'resume' }))),
    retry: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    stop: vi.fn(async () => announce(state && reduceRun(state, { type: 'stop' }))),
    skip: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    forget: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    choose: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    heroSheet: vi.fn(async (): Promise<RunReply> => ({ ok: true, state })),
    checks: vi.fn(async () => ({ ok: true as const, flowOpen: false, rows: [] })),
    openFlow: vi.fn(async () => ({ ok: true as const })),
    showMe: vi.fn(async () => ({ ok: true as const, missing: [] })),
    testPrompt: vi.fn(async () => ({ ok: true, message: 'Flow is ready.' })),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { client, announce, get state() { return state; } };
}

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** chrome.* as the panel uses it: local storage (step, activity, switch), tabs, windows and downloads. */
export function stubChrome(data: Record<string, unknown> = {}) {
  const listeners = new Set<Listener>();
  const tabs = {
    query: vi.fn(async (): Promise<unknown[]> => []),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    move: vi.fn(async () => ({})),
  };
  const windows = {
    update: vi.fn(async () => ({})),
    getAll: vi.fn(async (): Promise<unknown[]> => []),
    create: vi.fn(async () => ({ id: 50 })),
  };
  const fake = fakeDownloads();
  const downloads = fake.api;
  vi.stubGlobal('chrome', {
    runtime: { id: 'vidflow', getURL: (p: string) => `chrome-extension://vidflow${p}` },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(data, structuredClone(items));
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          listeners.forEach((l) => l(changes, 'local'));
        }),
        remove: vi.fn(async (key: string) => void delete data[key]),
      },
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    tabs,
    windows,
    downloads,
  });
  return { data, tabs, windows, downloads, fakeDownloads: fake, listeners };
}

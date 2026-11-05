/// <reference types="chrome" />
import type { Project } from '../store/projects';
import { HERO_SHEET_ID } from './run';

/** What the Flow panel shows about the run: the step it is on now, and a capped log of what it did. */
export type StepTarget = 'project' | 'setting' | 'prompt' | 'generate' | 'tile' | null;
export interface Step {
  projectId: string;
  sceneId: string | null;
  text: string;
  target: StepTarget;
  key?: string;
  at: number;
}
export interface ActivityEntry {
  at: number;
  projectId: string;
  sceneId: string | null;
  text: string;
}

export const STEP_KEY = 'vidflow.step';
export const ACTIVITY_KEY = 'vidflow.activity';
export const ACTIVITY_MAX = 300;

/** "Scene 3 · Pressing Generate", or just the text when it isn't about one scene. */
export function stepLine(sceneNumber: number | null, text: string): string {
  return sceneNumber === null ? text : `Scene ${sceneNumber} · ${text}`;
}

/** The number shown for a scene ("Scene 3"): its slide, else its place in the project. */
export function sceneNumber(project: Pick<Project, 'scenes'>, sceneId: string | null): number | null {
  if (!sceneId) return null;
  const i = project.scenes.findIndex((s) => s.id === sceneId);
  return i < 0 ? null : (project.scenes[i]!.slide ?? i + 1);
}

/** What a log line or step is about, as shown before its text: "Scene 3", "Model sheet", or null for the run itself. */
export function entryLabel(project: Pick<Project, 'scenes'> | null | undefined, sceneId: string | null): string | null {
  if (sceneId === HERO_SHEET_ID) return 'Model sheet';
  const n = project ? sceneNumber(project, sceneId) : null;
  return n === null ? null : `Scene ${n}`;
}

/** Storage writes take turns, so two quick calls never overwrite each other (read-modify-write). */
let chain: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn);
  chain = result.catch(() => undefined);
  return result;
}

export function setStep(step: Step | null): Promise<void> {
  return inTurn(async () => {
    if (step) await chrome.storage.local.set({ [STEP_KEY]: step });
    else await chrome.storage.local.remove(STEP_KEY);
  });
}

/** Appends an entry and keeps only the newest ACTIVITY_MAX (all projects share the one log). */
export function logActivity(entry: ActivityEntry): Promise<void> {
  return inTurn(async () => {
    const saved = ((await chrome.storage.local.get(ACTIVITY_KEY))[ACTIVITY_KEY] ?? []) as ActivityEntry[];
    await chrome.storage.local.set({ [ACTIVITY_KEY]: [...saved, entry].slice(-ACTIVITY_MAX) });
  });
}

/** One project's entries, newest first. */
export async function readActivity(projectId: string, limit = ACTIVITY_MAX): Promise<ActivityEntry[]> {
  const saved = ((await chrome.storage.local.get(ACTIVITY_KEY))[ACTIVITY_KEY] ?? []) as ActivityEntry[];
  return saved.filter((e) => e.projectId === projectId).reverse().slice(0, limit);
}

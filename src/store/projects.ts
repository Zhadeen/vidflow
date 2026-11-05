import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Scene } from '../scenes/types';
import type { StyleId } from '../prompts/styles';
import type { CharacterSpec } from '../prompts/build';
import { opfsMediaStore, type MediaStore } from './media';

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type SceneStatus = 'pending' | 'submitted' | 'done' | 'refused' | 'failed';
export interface SceneState {
  sceneId: string;
  status: SceneStatus;
  message?: string;
  pictureIds: string[];
  chosenPictureId?: string;
  /** While generating: the order and exact prompt this scene went to Flow with (result matching). */
  submission?: { seq: number; at: number; prompt: string };
  /** Flow media ids of the cards saved as this scene's pictures; never matched again. */
  cardKeys?: string[];
  /**
   * Generate was (about to be) pressed but Flow's start wasn't seen: the finished tiles before the press, to look for
   * it on Resume, and when that was (missing in runs saved before it was recorded).
   */
  unconfirmed?: { keysBefore: string[]; prompt: string; at?: number };
}
/** The hero's model sheet (made in Flow): kept apart from the scenes, so it is never a scene in the grid or export. */
export interface HeroSheet {
  status: SceneStatus;
  pictureIds: string[];
  message?: string;
  /** The shape the sheet was drawn in (absent in sheets saved before it was kept: use the project's). */
  aspect?: AspectRatio;
}
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The owner's script as pasted in the Script step (goes into the Claude prompt). */
  script?: string;
  scenes: Scene[];
  style: StyleId;
  customStyle?: string;
  character: CharacterSpec | null;
  aspect: AspectRatio;
  outputsPerPrompt: 1 | 2 | 4;
  sceneStates: Record<string, SceneState>;
  /** The latest model sheet of the hero; absent until one is made. */
  heroSheet?: HeroSheet;
}

interface VidflowDB extends DBSchema {
  projects: { key: string; value: Project };
}

let dbPromise: Promise<IDBPDatabase<VidflowDB>> | undefined;
function db() {
  dbPromise ??= openDB<VidflowDB>('vidflow', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

let media: MediaStore | undefined;
export function setMediaStore(store: MediaStore): void {
  media = store;
}
export function getMediaStore(): MediaStore {
  return mediaStore();
}
function mediaStore(): MediaStore {
  return (media ??= opfsMediaStore());
}

export async function createProject(name: string): Promise<Project> {
  const now = Date.now();
  const p: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    scenes: [],
    style: 'stickman-whiteboard',
    character: null,
    aspect: '16:9',
    outputsPerPrompt: 2,
    sceneStates: {},
  };
  await (await db()).put('projects', p);
  return p;
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function saveProject(p: Project): Promise<void> {
  p.updatedAt = Date.now();
  await (await db()).put('projects', p);
}

export async function listProjects(): Promise<Pick<Project, 'id' | 'name' | 'updatedAt'>[]> {
  const all = await (await db()).getAll('projects');
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await mediaStore().removeProject(id);
  await (await db()).delete('projects', id);
}

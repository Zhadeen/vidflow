import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Scene } from '../scenes/types';
import type { StyleId } from '../prompts/styles';
import type { CharacterSpec } from '../prompts/build';
import type { ClipRecord } from '../motion/timing';
import { opfsMediaStore, type MediaStore } from './media';

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type SceneStatus = 'pending' | 'submitted' | 'done' | 'refused' | 'failed';
export interface SceneState {
  sceneId: string;
  status: SceneStatus;
  message?: string;
  pictureIds: string[];
  chosenPictureId?: string;
  /** Who made the choice: the owner, or the auto-pick. Absent on a choice saved before Plan 3 (counts as owner). */
  choiceSource?: 'owner' | 'auto';
  autoReason?: string;
  autoChecked?: boolean;
  /** The motion clip made from the chosen picture, and a note when it could not be made. */
  clip?: ClipRecord;
  clipNote?: string;
  /** While generating: the order and exact prompt this scene went to Flow with (result matching). */
  /**
   * Clip runs: keysBefore / othersBefore, the finished tiles (poster keys) and how many other (drawing or refused) tiles
   * there were at the press, so a restart looks for this clip before pressing; clipKey, the finished tile matched to it.
   */
  submission?: { seq: number; at: number; prompt: string; keysBefore?: string[]; othersBefore?: number; clipKey?: string };
  /**
   * Whether these pictures were made with the hero reference attached in Flow (the Queue's "hero ✓"). Absent for
   * pictures saved before VidFlow recorded it: no mark rather than a guess.
   */
  withHero?: boolean;
  /** Flow media ids of the cards saved as this scene's pictures; never matched again. */
  cardKeys?: string[];
  /**
   * Generate was (about to be) pressed but Flow's start wasn't seen: the finished tiles before the press, to look for
   * it on Resume, and when that was (missing in runs saved before it was recorded).
   */
  unconfirmed?: {
    keysBefore: string[];
    prompt: string;
    at?: number;
    /** Clip runs: the first submission's place in the order (after a restart). */
    seq?: number;
    /** Clip runs: how many drawing or refused tiles were in the grid at the press (they are older than it). */
    othersBefore?: number;
    /** Clip runs: credits already counted for a press Flow answered with its usage notice (not counted again). */
    paid?: number;
    /**
     * Clip runs: Flow confirmed this press started (the slide was in Flow before a restart). Its clip is never pressed
     * again by VidFlow: it is only looked for, and the run pauses for the owner when it can't be found.
     */
    confirmed?: true;
  };
}
/** The hero's model sheet (made in Flow): kept apart from the scenes, so it is never a scene in the grid or export. */
export interface HeroSheet {
  status: SceneStatus;
  pictureIds: string[];
  message?: string;
  /** The shape the sheet was drawn in (absent in sheets saved before it was kept: use the project's). */
  aspect?: AspectRatio;
}
export type MotionMode = 'stills' | 'picked' | 'all';
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
  /** Files tab: the sub-folder of Downloads this video's files go to (absent: the video's name, made file-safe). */
  downloadFolder?: string;
  /** Pictures VidFlow already downloaded for this video: media id → the file name it was given. */
  downloaded?: Record<string, string>;
  /** Which slides get a motion clip (absent: 'stills'). */
  motionMode?: MotionMode;
  /** Scene ids picked for a clip when motionMode is 'picked' (absent: none). */
  clipPicks?: string[];
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

/**
 * Changes one stored project in a single IndexedDB transaction (read and write together), so a change made by another
 * page or the background meanwhile can't be lost between the read and the write. `edit` changes the project in place or
 * returns its replacement, and must not await anything (the transaction would close). Returns the saved project, or
 * undefined when it is gone.
 */
export async function updateProject(id: string, edit: (p: Project) => Project | void): Promise<Project | undefined> {
  const tx = (await db()).transaction('projects', 'readwrite');
  const stored = await tx.store.get(id);
  let out: Project | undefined;
  if (stored) {
    out = edit(stored) ?? stored;
    out.updatedAt = Date.now();
    await tx.store.put(out);
  }
  await tx.done;
  return out;
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

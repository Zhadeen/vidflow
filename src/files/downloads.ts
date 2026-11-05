/// <reference types="chrome" />
import { logActivity, sceneNumber } from '../runs/activity';
import type { Scene } from '../scenes/types';
import { getAutoSave, getDownloadBoth, getNamingFormat, type NamingFormat } from '../settings';
import { getMediaStore, getProject, updateProject, type Project } from '../store/projects';
import { chosenPicture } from '../studio/chosen';
import { slideListCsv, timingJson } from './exports';
import { extFor, fileName, folderName } from './names';

/**
 * Saving files to the Mac (spec §19 Files, settled detail 6). Always through chrome.downloads, under the Downloads
 * folder, in the video's own sub-folder; an existing name gets a number added (uniquify), never overwritten.
 *
 * Where it runs:
 * - Download all and the exports run in the side panel (a page), which hands chrome.downloads an object URL of the
 *   picture VidFlow saved. Each object URL is revoked when its download completes (or after 60 s at the latest).
 * - Auto-save runs in the background service worker, where MV3 has no URL.createObjectURL. There Chrome downloads the
 *   picture straight from the signed Flow address it was just fetched and verified at (Flow's PNGs are 1.5–4 MB, too
 *   big for a data: URL). Only when there is no such address does a small picture (≤ 1.4 MB) go as a data: URL;
 *   anything bigger is not tried and logs "Couldn't save scene N to your Mac".
 *
 * Download all and auto-save can both save the same picture if Download all is pressed while a scene is being
 * auto-saved; that is harmless: uniquify gives the second copy a " (1)" name and nothing is overwritten.
 *
 * What is recorded: project.downloaded[mediaId] is first the name VidFlow asked for, as soon as Chrome accepts the
 * download (so a download whose end VidFlow never hears — the worker slept, the panel closed — still counts, and a
 * later Download all doesn't save it again); once it completes, the base name Chrome really saved under (it may carry
 * " (1)"). A download that is interrupted is not recorded (its early mark is taken off again).
 */

export interface DownloadResult {
  saved: number;
  /** Already downloaded for this video (left alone unless "again"). */
  skipped: number;
  /** Chrome refused or interrupted the download, or the picture couldn't be sent. */
  failed: number;
}

/** "Saving 37 of 400": called before each picture is handed to Chrome. */
export type Progress = (done: number, total: number) => void;

/** An object URL is revoked this long after its download starts at the latest. */
const REVOKE_AFTER_MS = 60_000;
/** How long to wait for a download to report complete before giving up on recording its name. */
const FINISH_WAIT_MS = 5 * 60_000;
/** The biggest picture sent as a data: URL (Chrome caps URLs at 2 MB; base64 adds a third). */
export const DATA_URL_MAX_BYTES = 1.4 * 1024 * 1024;

/**
 * A URL chrome.downloads can fetch for a blob: an object URL where the page has one, else a data: URL (only up to
 * DATA_URL_MAX_BYTES; bigger throws).
 */
export async function downloadUrl(blob: Blob): Promise<{ url: string; release(): void }> {
  if (typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(release, REVOKE_AFTER_MS);
    return { url, release };
  }
  if (blob.size > DATA_URL_MAX_BYTES) throw new Error('too big for a data: URL');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`, release: () => undefined };
}

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

type Finish = { state: 'complete'; name: string } | { state: 'interrupted' } | { state: 'unknown' };

/** Waits for download `id` to end: complete (with the base name Chrome saved it under), interrupted, or unknown. */
function finished(id: number): Promise<Finish> {
  return new Promise((resolve) => {
    let done = false;
    const end = (f: Finish) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(f);
    };
    const look = async () => {
      try {
        const [item] = await chrome.downloads.search({ id });
        if (!item) end({ state: 'unknown' });
        else if (item.state === 'complete') end({ state: 'complete', name: baseName(item.filename) });
        else if (item.state === 'interrupted') end({ state: 'interrupted' });
      } catch {
        end({ state: 'unknown' });
      }
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') void look();
      else if (delta.state.current === 'interrupted') end({ state: 'interrupted' });
    };
    const timer = setTimeout(() => end({ state: 'unknown' }), FINISH_WAIT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    // It may have finished already (a small file).
    void look();
  });
}

/**
 * Hands one file to Chrome as "<folder>/<name>" under Downloads; `end` says how it ended (wrapped so the caller can
 * start the next download without waiting). Throws when Chrome refuses it.
 */
async function save(source: { url: string } | { blob: Blob }, path: string): Promise<{ end: Promise<Finish> }> {
  const { url, release } = 'url' in source ? { url: source.url, release: () => undefined } : await downloadUrl(source.blob);
  let id: number;
  try {
    id = await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    release();
    throw e;
  }
  return { end: finished(id).finally(release) };
}

/** The sub-folder of Downloads for this video: its own folder name, else its name (both made file-safe). */
export function folderOf(project: Pick<Project, 'name' | 'downloadFolder'>): string {
  return folderName(project.downloadFolder?.trim() ? project.downloadFolder : project.name);
}

interface Picture {
  mediaId: string;
  /** null: missing from VidFlow's store. */
  blob: Blob | null;
  name: string;
}

/** A scene's pictures to save: the chosen one (plain name), then with `both` the others (_option2, _option3…). */
async function scenePictures(project: Project, scene: Scene, both: boolean, format: NamingFormat): Promise<Picture[]> {
  const state = project.sceneStates[scene.id];
  const chosen = chosenPicture(state);
  if (!state || !chosen) return [];
  const ids = [chosen, ...(both ? state.pictureIds.filter((id) => id !== chosen) : [])];
  const out: Picture[] = [];
  for (const [i, mediaId] of ids.entries()) {
    const blob = (await getMediaStore().get(mediaId).catch(() => undefined)) ?? null;
    const name = fileName(scene, format, i === 0 ? 'chosen' : 'other', extFor(blob?.type ?? ''), i + 1);
    out.push({ mediaId, blob, name });
  }
  return out;
}

/** An early mark to take off again: the name VidFlow wrote, and what was there before (a download "again"). */
type Unmark = { name: string; before: string | undefined };

/**
 * Records downloaded pictures on the stored project (one transaction, so other changes meanwhile are kept), and takes
 * off `unmark`'s early marks (only while each is still the one VidFlow wrote), putting back what was there before.
 */
async function markDownloaded(projectId: string, marks: Record<string, string>, unmark: Record<string, Unmark> = {}): Promise<void> {
  if (Object.keys(marks).length === 0 && Object.keys(unmark).length === 0) return;
  await updateProject(projectId, (p) => {
    const next = { ...p.downloaded, ...marks };
    for (const [mediaId, { name, before }] of Object.entries(unmark)) {
      if (next[mediaId] !== name) continue;
      if (before === undefined) delete next[mediaId];
      else next[mediaId] = before;
    }
    p.downloaded = next;
  });
}

/** Runs a project write; the coordinator passes its queue so the write takes its turn with the run's own. */
type Writer = (write: () => Promise<void>) => Promise<void>;
const direct: Writer = (write) => write();

interface SaveOptions {
  both: boolean;
  again?: boolean;
  /** Media id → the signed Flow address the picture was fetched from (auto-save). */
  urls?: Record<string, string>;
  onProgress?: Progress;
}

/**
 * Saves the pictures of `scenes` that aren't downloaded yet (all of them with `again`), one after another in scene
 * order, then records the names Chrome saved them under once they complete.
 */
async function savePictures(project: Project, scenes: Scene[], opts: SaveOptions, writer: Writer): Promise<DownloadResult> {
  const format = await getNamingFormat();
  const folder = folderOf(project);
  const result: DownloadResult = { saved: 0, skipped: 0, failed: 0 };
  const todo: Picture[] = [];
  for (const scene of scenes) {
    for (const pic of await scenePictures(project, scene, opts.both, format)) {
      if (!opts.again && project.downloaded?.[pic.mediaId]) result.skipped++;
      else todo.push(pic);
    }
  }
  const pending: { mediaId: string; name: string; end: Promise<Finish> }[] = [];
  for (const [i, pic] of todo.entries()) {
    opts.onProgress?.(i + 1, todo.length);
    const url = opts.urls?.[pic.mediaId];
    if (!url && !pic.blob) {
      result.failed++;
      continue;
    }
    try {
      const { end } = await save(url ? { url } : { blob: pic.blob! }, `${folder}/${pic.name}`);
      pending.push({ mediaId: pic.mediaId, name: pic.name, end });
    } catch {
      result.failed++;
    }
  }
  // Chrome has them: mark each under the name asked for now, before waiting to hear how they end.
  await writer(() => markDownloaded(project.id, Object.fromEntries(pending.map((d) => [d.mediaId, d.name]))));
  const marks: Record<string, string> = {};
  const unmark: Record<string, Unmark> = {};
  for (const { mediaId, name, end } of pending) {
    const f = await end;
    if (f.state === 'interrupted') {
      result.failed++;
      unmark[mediaId] = { name, before: project.downloaded?.[mediaId] };
      continue;
    }
    result.saved++;
    if (f.state === 'complete' && f.name !== name) marks[mediaId] = f.name;
  }
  await writer(() => markDownloaded(project.id, marks, unmark));
  return result;
}

/** Download all (Files tab): every scene's chosen picture, or both options; skips what was already downloaded. */
export async function downloadAll(
  projectId: string,
  opts: { both: boolean; again?: boolean; onProgress?: Progress },
): Promise<DownloadResult> {
  const project = await getProject(projectId);
  if (!project) throw new Error('This video is no longer in VidFlow.');
  return savePictures(project, project.scenes, opts, direct);
}

export const autoSaveProblem = (n: number | null) => `Couldn't save scene ${n ?? '?'} to your Mac`;

/**
 * Auto-save (only when its switch is on): right after a scene's pictures are saved in VidFlow, saves that scene's chosen
 * picture (or both options) to the Mac, from `urls` (the signed Flow addresses) when given. Never throws: a problem is
 * one activity line, and the run goes on.
 */
export async function autoSaveScene(
  projectId: string,
  sceneId: string,
  opts: { writer?: Writer; urls?: Record<string, string> } = {},
): Promise<void> {
  let project: Project | undefined;
  try {
    if (!(await getAutoSave())) return;
    project = await getProject(projectId);
    const scene = project?.scenes.find((s) => s.id === sceneId);
    // Only a scene that ended with its pictures saved (one skipped or stopped meanwhile has nothing to save).
    if (!project || !scene || project.sceneStates[sceneId]?.status !== 'done') return;
    const both = await getDownloadBoth();
    const result = await savePictures(project, [scene], { both, ...(opts.urls ? { urls: opts.urls } : {}) }, opts.writer ?? direct);
    if (result.failed > 0) throw new Error('download failed');
  } catch {
    const n = project ? sceneNumber(project, sceneId) : null;
    await logActivity({ at: Date.now(), projectId, sceneId: null, text: autoSaveProblem(n) }).catch(() => undefined);
  }
}

/** A scene's pictures were made again (same media ids, new pictures): they are no longer downloaded. */
export async function forgetDownloads(projectId: string, mediaIds: string[]): Promise<void> {
  await updateProject(projectId, (p) => {
    if (!p.downloaded || !mediaIds.some((id) => id in p.downloaded!)) return;
    const next = { ...p.downloaded };
    for (const id of mediaIds) delete next[id];
    p.downloaded = next;
  });
}

/**
 * Saves the Slide list ("<video name> slides.csv") or Timing file ("<video name> timing.json"); returns its path. The
 * File column names only pictures that were downloaded, as Chrome saved them.
 */
export async function downloadExport(projectId: string, kind: 'csv' | 'json'): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error('This video is no longer in VidFlow.');
  const path = `${folderOf(project)}/${folderName(project.name)} ${kind === 'csv' ? 'slides.csv' : 'timing.json'}`;
  const blob =
    kind === 'csv'
      ? new Blob([slideListCsv(project)], { type: 'text/csv;charset=utf-8' })
      : new Blob([timingJson(project)], { type: 'application/json' });
  const { end } = await save({ blob }, path);
  if ((await end).state === 'interrupted') throw new Error('download interrupted');
  return path;
}

/// <reference types="chrome" />
import { logActivity, sceneNumber } from '../runs/activity';
import type { Scene } from '../scenes/types';
import { getAutoSave, getDownloadBoth, getNamingFormat, type NamingFormat } from '../settings';
import { getMediaStore, getProject, updateProject, type Project } from '../store/projects';
import { chosenPicture } from '../studio/chosen';
import { slideListCsv, timingJson, type SceneFiles } from './exports';
import { extFor, fileName, folderName } from './names';

/**
 * Saving files to the Mac (spec §19 Files, settled detail 6). Always through chrome.downloads, under the Downloads
 * folder, in the video's own sub-folder; an existing name gets a number added (uniquify), never overwritten.
 *
 * Where it runs: Download all and the exports run in the side panel (a page), which hands chrome.downloads an object
 * URL. Auto-save runs in the background service worker, where MV3 has no URL.createObjectURL, so there the picture
 * goes as a data: URL instead (downloadUrl picks whichever the context has).
 */

export interface DownloadResult {
  saved: number;
  /** Already downloaded for this video (left alone unless "again"). */
  skipped: number;
  /** Chrome refused the download, or the picture is missing from VidFlow. */
  failed: number;
}

/** An object URL lives this long after its download starts (Chrome reads it while the download begins). */
const REVOKE_AFTER_MS = 60_000;

/** A URL chrome.downloads can fetch for a blob: an object URL where the page has one, else a data: URL. */
export async function downloadUrl(blob: Blob): Promise<{ url: string; release(): void }> {
  if (typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    return { url, release: () => setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS) };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`, release: () => undefined };
}

/** Saves one file as "<folder>/<name>" under Downloads. Throws when Chrome refuses it. */
async function save(blob: Blob, path: string): Promise<void> {
  const { url, release } = await downloadUrl(blob);
  try {
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
  } finally {
    release();
  }
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

/** Records downloaded pictures on the stored project (one transaction, so other changes meanwhile are kept). */
async function markDownloaded(projectId: string, marks: Record<string, string>): Promise<void> {
  if (Object.keys(marks).length === 0) return;
  await updateProject(projectId, (p) => {
    p.downloaded = { ...p.downloaded, ...marks };
  });
}

/** Runs a project write; the coordinator passes its queue so the write can't land between its own read and write. */
type Writer = (write: () => Promise<void>) => Promise<void>;
const direct: Writer = (write) => write();

/**
 * Saves the pictures of `scenes` that aren't downloaded yet (all of them with `again`), and records them.
 * Pictures go one after another, in scene order.
 */
async function savePictures(project: Project, scenes: Scene[], opts: { both: boolean; again?: boolean }, writer: Writer): Promise<DownloadResult> {
  const format = await getNamingFormat();
  const folder = folderOf(project);
  const result: DownloadResult = { saved: 0, skipped: 0, failed: 0 };
  const marks: Record<string, string> = {};
  for (const scene of scenes) {
    for (const pic of await scenePictures(project, scene, opts.both, format)) {
      if (!opts.again && project.downloaded?.[pic.mediaId]) {
        result.skipped++;
        continue;
      }
      if (!pic.blob) {
        result.failed++;
        continue;
      }
      try {
        await save(pic.blob, `${folder}/${pic.name}`);
        marks[pic.mediaId] = pic.name;
        result.saved++;
      } catch {
        result.failed++;
      }
    }
  }
  await writer(() => markDownloaded(project.id, marks));
  return result;
}

/** Download all (Files tab): every scene's chosen picture, or both options; skips what was already downloaded. */
export async function downloadAll(projectId: string, opts: { both: boolean; again?: boolean }): Promise<DownloadResult> {
  const project = await getProject(projectId);
  if (!project) throw new Error('This video is no longer in VidFlow.');
  return savePictures(project, project.scenes, opts, direct);
}

export const autoSaveProblem = (n: number | null) => `Couldn't save scene ${n ?? '?'} to your Mac`;

/**
 * Auto-save (only when its switch is on): right after a scene's pictures are saved in VidFlow, saves that scene's chosen
 * picture (or both options) to the Mac. Never throws: a problem is one activity line, and the run goes on.
 */
export async function autoSaveScene(projectId: string, sceneId: string, opts: { writer?: Writer } = {}): Promise<void> {
  let project: Project | undefined;
  try {
    if (!(await getAutoSave())) return;
    project = await getProject(projectId);
    const scene = project?.scenes.find((s) => s.id === sceneId);
    // Only a scene that ended with its pictures saved (one skipped or stopped meanwhile has nothing to save).
    if (!project || !scene || project.sceneStates[sceneId]?.status !== 'done') return;
    const result = await savePictures(project, [scene], { both: await getDownloadBoth() }, opts.writer ?? direct);
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

/** File names for the exports: what each scene's chosen picture was downloaded as, else the name it would get. */
export async function exportFiles(project: Project): Promise<SceneFiles> {
  const format = await getNamingFormat();
  const files: SceneFiles = {};
  for (const scene of project.scenes) {
    const [chosen] = await scenePictures(project, scene, false, format);
    if (!chosen) continue;
    files[scene.id] = project.downloaded?.[chosen.mediaId] ?? chosen.name;
  }
  return files;
}

/** Saves the Slide list ("<video name> slides.csv") or Timing file ("<video name> timing.json"); returns its path. */
export async function downloadExport(projectId: string, kind: 'csv' | 'json'): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error('This video is no longer in VidFlow.');
  const files = await exportFiles(project);
  const path = `${folderOf(project)}/${folderName(project.name)} ${kind === 'csv' ? 'slides.csv' : 'timing.json'}`;
  const blob =
    kind === 'csv'
      ? new Blob([slideListCsv(project, files)], { type: 'text/csv;charset=utf-8' })
      : new Blob([timingJson(project, files)], { type: 'application/json' });
  await save(blob, path);
  return path;
}

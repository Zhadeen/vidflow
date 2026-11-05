import type { Scene } from '../scenes/types';
import type { Project, SceneStatus } from '../store/projects';
import { chosenPicture } from '../studio/chosen';

/** Scene id → the file name of its (chosen) picture. */
export type SceneFiles = Record<string, string>;

const STATUS: Record<SceneStatus, string> = {
  pending: 'To go',
  submitted: 'Drawing',
  done: 'Saved',
  refused: 'Refused',
  failed: 'Failed',
};

const two = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${two(Math.floor(Math.max(0, s) / 60))}:${two(Math.floor(Math.max(0, s)) % 60)}`;
/** "00:04 - 00:08", as in Claude's scene table; empty when the scene has no timecode. */
const timecode = (scene: Scene) => (scene.start !== null && scene.end !== null ? `${clock(scene.start)} - ${clock(scene.end)}` : '');

/** The file name for a scene: the one given, else the name its chosen picture was downloaded as; null when neither. */
function fileOf(project: Project, scene: Scene, files: SceneFiles | undefined): string | null {
  const given = files?.[scene.id];
  if (given) return given;
  const chosen = chosenPicture(project.sceneStates[scene.id]);
  return (chosen && project.downloaded?.[chosen]) || null;
}

/** RFC 4180: a field with a comma, quote or line break goes in quotes, its quotes doubled. */
function field(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The slide list (spec §19): Slide, Timecode, Sentence, Status, File — CRLF lines, RFC 4180 quoting. */
export function slideListCsv(project: Project, files?: SceneFiles): string {
  const rows = project.scenes.map((scene) => {
    const status = STATUS[project.sceneStates[scene.id]?.status ?? 'pending'];
    return [scene.slide, timecode(scene), scene.sentence, status, fileOf(project, scene, files) ?? ''].map(field).join(',');
  });
  return ['Slide,Timecode,Sentence,Status,File', ...rows].join('\r\n');
}

/** The timing file (spec §19), for voice alignment later: [{ slide, start, end, sentence, file }]. */
export function timingJson(project: Project, files?: SceneFiles): string {
  const rows = project.scenes.map((scene) => ({
    slide: scene.slide,
    start: scene.start,
    end: scene.end,
    sentence: scene.sentence,
    file: fileOf(project, scene, files),
  }));
  return JSON.stringify(rows, null, 2);
}

/// <reference types="chrome" />
import { useEffect, useId, useMemo, useState } from 'react';
import { downloadAll, downloadExport, folderOf, type DownloadResult } from '../files/downloads';
import { fileName } from '../files/names';
import type { RunState } from '../runs/run';
import type { Scene } from '../scenes/types';
import {
  AUTO_SAVE_KEY,
  DEFAULT_NAMING_FORMAT,
  DOWNLOAD_BOTH_KEY,
  getAutoSave,
  getDownloadBoth,
  getNamingFormat,
  NAMING_FORMAT_KEY,
  NAMING_FORMATS,
  setAutoSave,
  setDownloadBoth,
  setNamingFormat,
  type NamingFormat,
} from '../settings';
import type { MediaStore } from '../store/media';
import { getMediaStore, type Project } from '../store/projects';
import { Button } from '../studio/Button';
import { chosenPicture } from '../studio/chosen';
import { sceneStatesFor } from '../studio/progress';
import type { ProjectPatch } from '../studio/ScriptStep';
import { usePictureUrls } from '../studio/usePictureUrls';
import { Switch, useStoredSwitch } from './PanelChecks';
import { FieldSelect } from './PanelSetup';

/** The small grid shows this many chosen pictures; the last cell says how many more there are. */
const GRID = 8;

/** Slide 1, 0–3 s: the example each naming format is shown with (as in the approved panel). */
const EXAMPLE: Scene = {
  id: 'example',
  slide: 1,
  start: 0,
  end: 3,
  sentence: '',
  concept: '',
  textOverlay: '',
  imagePrompt: '',
  motionPrompt: '',
  motionPromptIsDefault: true,
};
const FORMAT_OPTIONS = NAMING_FORMATS.map((f) => ({ value: f, label: fileName(EXAMPLE, f, 'chosen', 'png') }));

const pictures = (n: number) => `${n} picture${n === 1 ? '' : 's'}`;
const scenesText = (n: number) => `${n} scene${n === 1 ? '' : 's'}`;

/** The naming format: null until read; follows changes made elsewhere. */
function useNamingFormat(): [NamingFormat | null, (f: NamingFormat) => void] {
  const [format, setFormat] = useState<NamingFormat | null>(null);
  useEffect(() => {
    let alive = true;
    getNamingFormat().then(
      (f) => alive && setFormat((now) => now ?? f),
      () => alive && setFormat((now) => now ?? DEFAULT_NAMING_FORMAT),
    );
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const value = changes[NAMING_FORMAT_KEY]?.newValue;
      if (area === 'local' && NAMING_FORMATS.includes(value as NamingFormat)) setFormat(value as NamingFormat);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return [format, setFormat];
}

interface Props {
  project: Project;
  /** The run, so the counts match the Queue's while one is live. */
  run: RunState | null;
  /** Saves an edit of this video (its download folder). */
  onChange(patch: ProjectPatch): void;
  media?: MediaStore;
}

type Message = { text: string; problem: boolean; again?: boolean };

/**
 * Files (spec §19): what is saved in VidFlow, where and how it downloads to the Mac, the auto-save switch, the slide
 * list and timing exports, what comes next, and the coral Download all.
 */
export function PanelFiles({ project, run, onChange, media }: Props) {
  const ids = useId();
  const store = media ?? getMediaStore();
  const [autoSave, setAutoSaveOn] = useStoredSwitch(AUTO_SAVE_KEY, getAutoSave, false);
  const [both, setBoth] = useStoredSwitch(DOWNLOAD_BOTH_KEY, getDownloadBoth, false);
  const [format, setFormat] = useNamingFormat();
  const [folder, setFolder] = useState(() => folderOf(project));
  const [busy, setBusy] = useState<null | 'all' | 'csv' | 'json'>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Another video, or its folder changed elsewhere: show its folder.
  useEffect(() => setFolder(folderOf(project)), [project.id, project.downloadFolder, project.name]);

  const saved = useMemo(() => {
    const states = sceneStatesFor(project, run);
    return project.scenes.flatMap((s) => {
      const state = states[s.id];
      const chosen = chosenPicture(state);
      return chosen && state ? [{ chosen, count: state.pictureIds.length }] : [];
    });
  }, [project, run]);
  const total = saved.reduce((n, s) => n + s.count, 0);
  const count = both ? total : saved.length;
  const shown = saved.slice(0, GRID).map((s) => s.chosen);
  const urls = usePictureUrls(store, shown);
  const more = saved.length - shown.length;
  const where = `Downloads/${folderOf(project)}`;

  function flip(set: (on: boolean) => void, save: (on: boolean) => Promise<void>, on: boolean) {
    set(on);
    save(on).catch(() => {
      set(!on);
      setMessage({ text: "VidFlow couldn't save that choice. Try again.", problem: true });
    });
  }

  function pickFormat(value: string) {
    const f = value as NamingFormat;
    const before = format;
    setFormat(f);
    setNamingFormat(f).catch(() => {
      if (before) setFormat(before);
      setMessage({ text: "VidFlow couldn't save that choice. Try again.", problem: true });
    });
  }

  /** The folder as typed, made file-safe; the video's own name means "no folder of its own". */
  function commitFolder() {
    const safe = folderOf({ name: project.name, downloadFolder: folder });
    setFolder(safe);
    const own = safe === folderOf({ name: project.name }) ? undefined : safe;
    if (own !== project.downloadFolder) onChange({ downloadFolder: own });
  }

  async function all(again = false) {
    setBusy('all');
    setMessage(null);
    try {
      const r: DownloadResult = await downloadAll(project.id, { both: both === true, again, onProgress: (done, total) => setProgress({ done, total }) });
      if (r.failed > 0) {
        setMessage({
          text: `Couldn't save ${pictures(r.failed)} to your Mac${r.saved ? ` (saved ${r.saved})` : ''}. Check Chrome can download, then try again.`,
          problem: true,
        });
      } else if (r.saved === 0 && r.skipped > 0) {
        setMessage({ text: `All ${r.skipped} are already in ${where}. Download them again?`, problem: false, again: true });
      } else if (r.skipped > 0) {
        setMessage({ text: `Saved ${pictures(r.saved)} to ${where}. ${r.skipped} already there were left alone.`, problem: false, again: true });
      } else {
        setMessage({ text: `Saved ${pictures(r.saved)} to ${where}.`, problem: false });
      }
    } catch {
      setMessage({ text: "VidFlow couldn't save the pictures. Try again.", problem: true });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function exportFile(kind: 'csv' | 'json') {
    setBusy(kind);
    setMessage(null);
    try {
      const path = await downloadExport(project.id, kind);
      setMessage({ text: `Saved ${path.slice(path.lastIndexOf('/') + 1)} to ${where}.`, problem: false });
    } catch {
      setMessage({ text: `VidFlow couldn't save the ${kind === 'csv' ? 'slide list' : 'timing file'}. Try again.`, problem: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="vf-pn-label">
        {scenesText(saved.length)} · {pictures(total)} saved in VidFlow
      </p>
      {shown.length > 0 && (
        <ul className="vf-pn-grid" aria-label="Chosen pictures">
          {shown.map((id, i) => (
            <li key={id} className="vf-pn-gridcell" data-empty={urls[id] ? undefined : ''}>
              {urls[id] && <img src={urls[id]} alt="" />}
              {i === shown.length - 1 && more > 0 && <span className="vf-pn-gridmore">+{more}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="vf-pn-label">Download to your Mac</p>
      <label className="vf-pn-field vf-pn-folder">
        <span>Folder: Downloads /</span>
        <input
          aria-label="Download folder"
          value={folder}
          spellCheck={false}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={commitFolder}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <FieldSelect label="Names" prefix="Names: " value={format ?? ''} options={FORMAT_OPTIONS} disabled={format === null} onChange={pickFormat} />
      <div className="vf-pn-chips">
        <fieldset className="vf-pn-chipset" disabled={both === null}>
          <legend className="vf-visually-hidden">Which pictures</legend>
          <label className="vf-pn-chip">
            <input type="radio" name={`${ids}-which`} checked={both === false} onChange={() => flip(setBoth, setDownloadBoth, false)} />
            <span>Chosen picture only</span>
          </label>
          <label className="vf-pn-chip">
            <input type="radio" name={`${ids}-which`} checked={both === true} onChange={() => flip(setBoth, setDownloadBoth, true)} />
            <span>Both options</span>
          </label>
        </fieldset>
      </div>
      <ul className="vf-pn-checks" aria-label="Auto-save">
        <Switch label="Save automatically as each scene finishes" on={autoSave} onChange={(on) => flip(setAutoSaveOn, setAutoSave, on)} />
      </ul>

      <p className="vf-pn-label vf-pn-label-gap">Also</p>
      <div className="vf-pn-pair">
        <Button className="vf-pn-sec" onClick={() => void exportFile('csv')} loading={busy === 'csv'} disabled={busy !== null || project.scenes.length === 0}>
          Slide list (CSV)
        </Button>
        <Button className="vf-pn-sec" onClick={() => void exportFile('json')} loading={busy === 'json'} disabled={busy !== null || project.scenes.length === 0}>
          Timing file
        </Button>
      </div>

      <p className="vf-pn-label vf-pn-label-gap">Coming next</p>
      <p className="vf-pn-note">Clips · Voice · Finished video (MP4)</p>

      {busy === 'all' && progress && (
        <p className="vf-pn-sub" role="status">
          Saving {progress.done} of {progress.total}…
        </p>
      )}
      {message?.problem && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {message.text}
        </p>
      )}
      {message && !message.problem && (
        <div className="vf-pn-flow-closed" role="status">
          <p className="vf-pn-sub">{message.text}</p>
          {message.again && (
            <Button className="vf-pn-sec" onClick={() => void all(true)} disabled={busy !== null}>
              Download again
            </Button>
          )}
        </div>
      )}

      <div className="vf-pn-actions vf-pn-end">
        <Button variant="primary" onClick={() => void all()} loading={busy === 'all'} disabled={count === 0 || both === null || (busy !== null && busy !== 'all')}>
          {count === 0 ? 'Download all pictures' : `Download all ${pictures(count)}`}
        </Button>
      </div>
    </>
  );
}

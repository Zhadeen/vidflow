import { useEffect, useId, useRef, useState } from 'react';
import type { RunReply } from '../flow/messages';
import { HERO_SHEET_ID, isHeroSheetRun, USER_PAUSE_REASON, type RunState } from '../runs/run';
import { getMediaStore, type HeroSheet, type Project } from '../store/projects';
import { Button } from './Button';
import type { RunClient } from './runClient';
import { aspectCss } from './SceneGrid';
import { usePictureUrls } from './usePictureUrls';

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const REJECTED = 'Use a PNG, JPEG or WebP picture under 10 MB.';
const NAME = 'hero-reference';

/**
 * Stores the picture as the project's hero reference and returns its media id. Only the picture is stored: the
 * project's character is saved by the studio's edit queue, so a description typed meanwhile is kept.
 */
export async function setHeroReference(projectId: string, file: Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!TYPES.includes(file.type) || file.size > REFERENCE_MAX_BYTES) return { ok: false, message: REJECTED };
  await getMediaStore().put(projectId, NAME, file);
  return { ok: true };
}

/** Deletes the reference picture (and only that file). */
export async function clearHeroReference(projectId: string): Promise<void> {
  await getMediaStore().remove(`${projectId}/${NAME}`);
}

/** What the hero section needs to make the model sheet in Flow (the Script step passes the studio's run and client). */
export interface SheetControls {
  run: RunState | null;
  client: RunClient;
  /** The run as the background reported it after a request. */
  onRunState(state: RunState | null): void;
}

const SHEET_PICTURE_GONE = "VidFlow can't find that picture any more. Make the model sheet again.";
const SHEET_USE_FAILED = "VidFlow couldn't use that picture. Try again.";

/** Flow's pictures normally say their type; one that doesn't is read from its first bytes (PNG, JPEG or WebP). */
async function withPictureType(blob: Blob): Promise<Blob> {
  if (blob.type) return blob;
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  const type =
    b[0] === 0x89 && ascii(1, 4) === 'PNG'
      ? 'image/png'
      : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
        ? 'image/jpeg'
        : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
          ? 'image/webp'
          : '';
  return type ? new Blob([blob], { type }) : blob;
}

export function HeroReference({
  project,
  onChange,
  disabled,
  sheet,
}: {
  project: Project;
  /** The hero's new reference media id, or undefined once it is removed. */
  onChange(referenceMediaId: string | undefined): void;
  disabled?: boolean;
  /** Shows "Make a model sheet in Flow" and the sheet's pictures; left out where there is no run client. */
  sheet?: SheetControls;
}) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  /** The media id stays the same when a picture is replaced, so each upload bumps this to reload the thumbnail. */
  const [version, setVersion] = useState(0);
  const mediaId = project.character?.referenceMediaId;
  // An upload finishes later: report through the latest render, so a description typed meanwhile is kept.
  const report = useRef(onChange);
  report.current = onChange;

  useEffect(() => {
    if (!mediaId) {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let stale = false;
    void getMediaStore()
      .get(mediaId)
      .then((blob) => {
        if (stale || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [mediaId, version]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const result = await setHeroReference(project.id, file);
      if (!result.ok) return setError(result.message);
      setVersion((v) => v + 1);
      report.current(`${project.id}/${NAME}`);
    } catch {
      setError("VidFlow couldn't save that picture. Try again.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  /** Copies a model sheet picture in as the hero reference (replacing any), then reports it like an upload. */
  async function useSheetPicture(pictureId: string) {
    setError(null);
    setBusy(true);
    try {
      const blob = await getMediaStore().get(pictureId);
      if (!blob) return setError(SHEET_PICTURE_GONE);
      const result = await setHeroReference(project.id, await withPictureType(blob));
      if (!result.ok) return setError(result.message);
      setVersion((v) => v + 1);
      report.current(`${project.id}/${NAME}`);
    } catch {
      setError(SHEET_USE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await clearHeroReference(project.id);
      report.current(undefined);
    } catch {
      setError("VidFlow couldn't remove that picture. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vf-hero-ref">
      <input
        ref={picker}
        id={inputId}
        type="file"
        className="vf-visually-hidden"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <label className="vf-visually-hidden" htmlFor={inputId}>
        Hero reference picture file
      </label>
      <div className="vf-row">
        {mediaId && url && <img className="vf-hero-ref-thumb" src={url} alt="Hero reference picture" />}
        <Button small disabled={busy || disabled} onClick={() => picker.current?.click()}>
          {mediaId ? 'Replace picture' : 'Add a reference picture'}
        </Button>
        {mediaId && (
          <Button small disabled={busy || disabled} onClick={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
      <p className="vf-hint" style={{ margin: 'var(--vf-space-2) 0 0' }}>
        Flow matches the hero to this picture. PNG, JPEG or WebP, up to 10 MB.
      </p>
      {error && (
        <p className="vf-notice" role="alert" style={{ margin: 'var(--vf-space-2) 0 0' }}>
          {error}
        </p>
      )}
      {sheet && (
        <ModelSheet
          project={project}
          controls={sheet}
          disabled={disabled}
          busy={busy}
          onUse={(pictureId) => void useSheetPicture(pictureId)}
        />
      )}
    </div>
  );
}

interface ModelSheetProps {
  project: Project;
  controls: SheetControls;
  disabled?: boolean;
  /** A picture is being stored as the reference: the "Use" buttons wait. */
  busy: boolean;
  onUse(pictureId: string): void;
}

/**
 * "Make a model sheet in Flow": one prompt draws the hero from the front, side and back with 3 expressions. Its
 * pictures show here, each with "Use as hero reference". A live sheet run is fresher than the saved project.
 */
function ModelSheet({ project, controls, disabled, busy, onUse }: ModelSheetProps) {
  const { run, client, onRunState } = controls;
  const ids = useId();
  const [asking, setAsking] = useState<null | 'make' | 'resume'>(null);
  const [error, setError] = useState<string | null>(null);
  const live =
    run && isHeroSheetRun(run) && run.projectId === project.id && (run.status === 'running' || run.status === 'paused') ? run : null;
  const liveSheet = live?.sceneStates[HERO_SHEET_ID];
  const sheet: HeroSheet | undefined = liveSheet
    ? { status: liveSheet.status, pictureIds: liveSheet.pictureIds, ...(liveSheet.message ? { message: liveSheet.message } : {}) }
    : project.heroSheet;
  const working = !!live && (sheet?.status === 'pending' || sheet?.status === 'submitted');
  const described = !!project.character?.description.trim();
  const pictures = sheet?.status === 'done' ? sheet.pictureIds : [];
  const urls = usePictureUrls(getMediaStore(), pictures);

  async function ask(kind: 'make' | 'resume', request: () => Promise<RunReply>) {
    setAsking(kind);
    setError(null);
    try {
      const reply = await request();
      if (reply.ok) onRunState(reply.state);
      else setError(reply.message);
    } catch {
      setError("VidFlow's background didn't answer. Try again.");
    } finally {
      setAsking(null);
    }
  }
  const make = () => void ask('make', () => client.heroSheet(project.id));

  return (
    <div className="vf-hero-sheet" aria-labelledby={`${ids}-title`}>
      <p className="vf-hero-sheet-title" id={`${ids}-title`}>
        Model sheet
      </p>
      <p className="vf-hint" style={{ margin: 0 }}>
        One prompt in Flow draws the hero from the front, side and back, with 3 expressions. Pick one as the hero
        reference.
      </p>
      <div className="vf-row">
        <Button small onClick={make} loading={asking === 'make'} disabled={disabled || !described || !!live || asking !== null}>
          Make a model sheet in Flow
        </Button>
      </div>

      {live && live.status === 'paused' ? (
        <div className="vf-stack" style={{ gap: 'var(--vf-space-2)' }}>
          <p className={live.pauseReason && live.pauseReason !== USER_PAUSE_REASON ? 'vf-notice' : 'vf-hint'} role="alert" style={{ margin: 0 }}>
            {live.pauseReason && live.pauseReason !== USER_PAUSE_REASON ? live.pauseReason : 'The model sheet is paused. Press Resume to carry on.'}
          </p>
          <div className="vf-row">
            <Button small onClick={() => void ask('resume', () => client.resume())} loading={asking === 'resume'} disabled={asking !== null}>
              Resume
            </Button>
          </div>
        </div>
      ) : working ? (
        <p className="vf-status" role="status" style={{ margin: 0 }}>
          <span className="vf-working">Flow is drawing the model sheet…</span> You can leave this tab.
        </p>
      ) : sheet && (sheet.status === 'refused' || sheet.status === 'failed') ? (
        <div className="vf-hero-sheet-problem">
          <div>
            <p className="vf-what">{sheet.status === 'refused' ? 'Flow refused the model sheet' : "The model sheet didn't work"}</p>
            <p className="vf-why">{sheet.message ?? 'No reason was given.'}</p>
          </div>
          <Button small onClick={make} loading={asking === 'make'} disabled={disabled || !described || asking !== null}>
            Try again
          </Button>
        </div>
      ) : null}

      {error && (
        <p className="vf-notice" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {pictures.length > 0 && (
        <div className="vf-hero-sheet-pictures">
          {pictures.map((id, i) => (
            <figure key={id} className="vf-hero-sheet-picture" aria-labelledby={`${ids}-pic-${i}`}>
              <span className="vf-hero-sheet-frame" style={{ aspectRatio: aspectCss(project.aspect) }}>
                {urls[id] && <img src={urls[id]} alt={`Model sheet picture ${i + 1} of ${pictures.length}`} />}
              </span>
              <figcaption>
                <span className="vf-option-title" id={`${ids}-pic-${i}`}>
                  Picture {i + 1} of {pictures.length}
                </span>
                <Button small disabled={busy || disabled} aria-describedby={`${ids}-pic-${i}`} onClick={() => onUse(id)}>
                  Use as hero reference
                </Button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

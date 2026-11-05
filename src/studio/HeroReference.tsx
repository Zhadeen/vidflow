import { useEffect, useId, useRef, useState } from 'react';
import { getMediaStore, type Project } from '../store/projects';
import { Button } from './Button';

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

export function HeroReference({ project, onChange, disabled }: { project: Project; /** The hero's new reference media id, or undefined once it is removed. */
  onChange(referenceMediaId: string | undefined): void; disabled?: boolean }) {
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
    </div>
  );
}

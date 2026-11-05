import { useEffect, useId, useRef, useState } from 'react';
import { getMediaStore, getProject, saveProject, type Project } from '../store/projects';
import { Button } from './Button';

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const REJECTED = 'Use a PNG, JPEG or WebP picture under 10 MB.';
const NAME = 'hero-reference';

/** The hero with this reference (or without it); an empty hero with no reference is no hero at all. */
function withReference(project: Project, referenceMediaId: string | undefined): Project['character'] {
  const description = project.character?.description ?? '';
  if (!referenceMediaId) return description.trim() ? { description } : null;
  return { description, referenceMediaId };
}

/** Stores the picture as the project's hero reference. Nothing is stored when it isn't an allowed picture. */
export async function setHeroReference(projectId: string, file: Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!TYPES.includes(file.type) || file.size > REFERENCE_MAX_BYTES) return { ok: false, message: REJECTED };
  const project = await getProject(projectId);
  if (!project) return { ok: false, message: 'This video is no longer in VidFlow.' };
  const id = await getMediaStore().put(projectId, NAME, file);
  await saveProject({ ...project, character: withReference(project, id) });
  return { ok: true };
}

/** Removes the reference picture (and only that file). The description stays. */
export async function clearHeroReference(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  await getMediaStore().remove(`${projectId}/${NAME}`);
  if (project) await saveProject({ ...project, character: withReference(project, undefined) });
}

export function HeroReference({ project, onChange, disabled }: { project: Project; onChange(p: Project): void; disabled?: boolean }) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const mediaId = project.character?.referenceMediaId;

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
  }, [mediaId]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const result = await setHeroReference(project.id, file);
      if (!result.ok) return setError(result.message);
      onChange({ ...project, character: withReference(project, `${project.id}/${NAME}`) });
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
      onChange({ ...project, character: withReference(project, undefined) });
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
        aria-label="Hero reference picture file"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
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

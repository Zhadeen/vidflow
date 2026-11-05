import { useState, type FormEvent } from 'react';
import { Button } from './Button';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  sceneCount: number;
  doneCount: number;
}

interface Props {
  /** null while loading. */
  projects: ProjectSummary[] | null;
  onCreate(name: string): void | Promise<void>;
  onOpen(id: string): void;
  onDelete(id: string): void | Promise<void>;
  /** Shown when loading or saving failed. */
  error?: string | null;
}

const DEFAULT_NAME = 'Untitled video';

function edited(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `today at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function meta(p: ProjectSummary): string {
  if (p.sceneCount === 0) return `No scenes yet · edited ${edited(p.updatedAt)}`;
  const scenes = `${p.sceneCount} ${p.sceneCount === 1 ? 'scene' : 'scenes'}`;
  return `${scenes} · pictures for ${p.doneCount} · edited ${edited(p.updatedAt)}`;
}

export function ProjectsHome({ projects, onCreate, onOpen, onDelete, error }: Props) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await onCreate(name.trim() || DEFAULT_NAME);
      setName('');
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    try {
      await onDelete(id);
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  return (
    <div className="vf-stack">
      <h1 className="vf-h1">Your videos</h1>
      <form className="vf-panel vf-new-project" onSubmit={create}>
        <div>
          <label className="vf-label" htmlFor="vf-new-name">
            Name your next video
          </label>
          <input
            id="vf-new-name"
            className="vf-input"
            value={name}
            placeholder={DEFAULT_NAME}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" loading={creating}>
          New project
        </Button>
      </form>

      {error && (
        <p className="vf-notice" role="alert">
          {error}
        </p>
      )}

      {projects === null ? (
        <p className="vf-hint" aria-live="polite">
          Loading your videos…
        </p>
      ) : projects.length === 0 ? (
        <p className="vf-empty">No videos yet. Name your first one above, then press New project.</p>
      ) : (
        <ul className="vf-project-list" aria-label="Your videos">
          {projects.map((p) => (
            <li key={p.id} className="vf-project-row">
              <div className="vf-project-row-main">
                <p className="vf-project-row-name">{p.name}</p>
                <p className="vf-project-row-meta">
                  {confirming === p.id ? 'Delete this video and all its pictures? This cannot be undone.' : meta(p)}
                </p>
              </div>
              <div className="vf-row-actions">
                {confirming === p.id ? (
                  <>
                    <Button small onClick={() => void remove(p.id)} loading={deleting === p.id}>
                      Delete
                    </Button>
                    <Button small onClick={() => setConfirming(null)} disabled={deleting === p.id}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <>
                    <Button small onClick={() => onOpen(p.id)}>
                      Open
                    </Button>
                    <Button small onClick={() => setConfirming(p.id)} aria-label={`Delete ${p.name}`}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

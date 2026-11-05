import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunState } from '../runs/run';
import type { MediaStore } from '../store/media';
import { createProject, deleteProject, getProject, listProjects, type Project } from '../store/projects';
import { applyPatch, saveEdits } from './projectEdits';
import { ProjectScreen } from './ProjectScreen';
import { ProjectsHome, type ProjectSummary } from './ProjectsHome';
import type { RunClient } from './runClient';
import type { ProjectPatch } from './ScriptStep';

const SAVE_FAILED = "VidFlow couldn't save your last change. Check Chrome has free disk space, then make the change again.";

function hashProjectId(): string | null {
  const m = /^#\/project\/([\w-]+)$/.exec(window.location.hash);
  return m ? m[1] : null;
}

async function summaries(): Promise<ProjectSummary[]> {
  const list = await listProjects();
  const full = await Promise.all(list.map((p) => getProject(p.id)));
  return full
    .filter((p): p is Project => !!p)
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      sceneCount: p.scenes.length,
      doneCount: p.scenes.filter((s) => p.sceneStates[s.id]?.status === 'done').length,
    }));
}

export function App({ client, media }: { client: RunClient; media: MediaStore }) {
  const [projectId, setProjectId] = useState<string | null>(hashProjectId);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  current.current = projectId;
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const open = useCallback((id: string | null) => {
    window.location.hash = id ? `#/project/${id}` : '';
  }, []);

  useEffect(() => {
    const onHash = () => setProjectId(hashProjectId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The run: what it is now, then every change the background announces.
  useEffect(() => {
    void client.get().then((reply) => reply.ok && setRun(reply.state));
    return client.subscribe((state) => {
      setRun(state);
      if (state.projectId !== current.current) return;
      // The background saved the scene states into the project before announcing; take only those.
      void getProject(state.projectId).then((fresh) => {
        if (fresh) setProject((p) => (p && p.id === fresh.id ? { ...p, sceneStates: fresh.sceneStates } : p));
      });
    });
  }, [client]);

  useEffect(() => {
    setError(null);
    if (!projectId) {
      setProject(null);
      setProjects(null);
      summaries().then(setProjects, () => {
        setProjects([]);
        setError("VidFlow couldn't load your videos. Close this tab and open VidFlow again.");
      });
      return;
    }
    let cancelled = false;
    getProject(projectId).then(
      (p) => {
        if (cancelled) return;
        if (p) setProject(p);
        else open(null);
      },
      () => !cancelled && setError("VidFlow couldn't open this video. Go back to your videos and try again."),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, open]);

  const change = useCallback((patch: ProjectPatch) => {
    setProject((p) => (p ? applyPatch(p, patch) : p));
    const id = current.current;
    if (!id) return;
    // Saves run one after another, in the order the owner made the changes.
    saving.current = saving.current.then(() => saveEdits(id, patch)).catch(() => setError(SAVE_FAILED));
  }, []);

  if (projectId) {
    return (
      <>
        {error && (
          <p className="vf-notice" role="alert" style={{ maxWidth: 1280, margin: '0 auto var(--vf-space-4)' }}>
            {error}
          </p>
        )}
        {project && project.id === projectId ? (
          <ProjectScreen key={project.id} project={project} run={run} client={client} media={media} onChange={change} onHome={() => open(null)} />
        ) : (
          !error && <p className="vf-hint">Opening your video…</p>
        )}
      </>
    );
  }

  return (
    <div className="vf-shell">
      <header className="vf-header">
        <span className="vf-wordmark">〰 VidFlow</span>
      </header>
      <ProjectsHome
        projects={projects}
        error={error}
        onOpen={(id) => open(id)}
        onCreate={async (name) => {
          try {
            const p = await createProject(name);
            open(p.id);
          } catch {
            setError("VidFlow couldn't make a new video. Check Chrome has free disk space, then try again.");
          }
        }}
        onDelete={async (id) => {
          if (run?.projectId === id && (run.status === 'running' || run.status === 'paused')) {
            setError('This video is making pictures. Open it and let the pictures finish before you delete it.');
            return;
          }
          try {
            await deleteProject(id);
            setProjects((list) => list?.filter((p) => p.id !== id) ?? null);
          } catch {
            setError("VidFlow couldn't delete that video. Try again.");
          }
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunReply } from '../flow/messages';
import type { RunState } from '../runs/run';
import { createProject, getProject, listProjects, type Project } from '../store/projects';
import { runPhase } from '../studio/progress';
import { applyPatch, saveEdits } from '../studio/projectEdits';
import { openStudio } from '../studio/openStudio';
import type { RunClient } from '../studio/runClient';
import type { ProjectPatch } from '../studio/ScriptStep';
import { PanelRun } from './PanelRun';
import { PanelSetup, VideoPicker } from './PanelSetup';

type Summary = Pick<Project, 'id' | 'name' | 'updatedAt'>;
export type PanelBusy = null | 'start' | 'pause' | 'resume' | 'stop';

const LOAD_FAILED = "VidFlow couldn't load your videos. Close this panel and open it again.";
const SAVE_FAILED = "VidFlow couldn't save your last change. Check Chrome has free disk space, then make the change again.";
const CREATE_FAILED = "VidFlow couldn't make a new video. Check Chrome has free disk space, then try again.";

const isLive = (run: RunState | null) => !!run && (run.status === 'running' || run.status === 'paused');

/**
 * VidFlow beside Flow (Chrome's side panel): pick a video, paste, choose, start; then follow the run. It shows the live
 * run's video if there is one, otherwise the most recently opened; the picker switches it (kept in the panel only).
 */
export function Panel({ client }: { client: RunClient }) {
  const [projects, setProjects] = useState<Summary[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState<PanelBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  current.current = projectId;
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const lastRun = useRef<RunState | null>(null);
  lastRun.current = run;

  // The run and the videos; then every change of the run the background announces (the studio hears the same).
  useEffect(() => {
    let alive = true;
    void Promise.all([client.get(), listProjects().catch(() => null)]).then(([reply, list]) => {
      if (!alive) return;
      const state = reply.ok ? reply.state : null;
      setRun(state);
      if (!list) {
        setProjects([]);
        setError(LOAD_FAILED);
        return;
      }
      setProjects(list);
      const live = state && isLive(state) && list.some((p) => p.id === state.projectId) ? state.projectId : null;
      setProjectId(live ?? list[0]?.id ?? null);
    });
    const unsubscribe = client.subscribe((state) => {
      const before = lastRun.current;
      lastRun.current = state;
      setRun(state);
      // A run just started (here or in the studio): the panel follows it, so both show the same video.
      const started = isLive(state) && !(before && before.projectId === state.projectId && isLive(before));
      if (started && state.projectId !== current.current) {
        setProjectId(state.projectId);
        return;
      }
      if (state.projectId !== current.current) return;
      // The background saved the scene states before announcing; take only those (edits here may be in flight).
      void getProject(state.projectId).then((fresh) => {
        if (fresh) setProject((p) => (p && p.id === fresh.id ? { ...p, sceneStates: fresh.sceneStates } : p));
      });
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;
    getProject(projectId).then(
      (p) => !cancelled && setProject(p ?? null),
      () => !cancelled && setError("VidFlow couldn't open this video. Pick it again."),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Back in the panel after the studio: show what was changed there (once this panel's own saves are done).
  useEffect(() => {
    const onFocus = () => {
      void saving.current.then(async () => {
        const id = current.current;
        const [fresh, list] = await Promise.all([id ? getProject(id) : undefined, listProjects()]);
        setProjects(list);
        if (fresh && fresh.id === current.current) setProject(fresh);
      }).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const change = useCallback(
    (patch: ProjectPatch) => {
      setProject((p) => (p ? applyPatch(p, patch) : p));
      const id = current.current;
      if (!id) return;
      saving.current = saving.current.then(() => saveEdits(id, patch)).catch(() => setError(SAVE_FAILED));
      // New scenes: a finished run for the old ones must not come back (the background forgets it), as in the studio.
      if (patch.scenes) void client.forget(id).then((reply) => reply.ok && setRun(reply.state));
    },
    [client],
  );

  async function act(kind: PanelBusy, request: () => Promise<RunReply>) {
    setBusy(kind);
    setError(null);
    try {
      const reply = await request();
      if (reply.ok) setRun(reply.state);
      else setError(reply.message);
    } finally {
      setBusy(null);
    }
  }

  async function create(name: string) {
    try {
      const p = await createProject(name);
      setProjects((list) => [p, ...(list ?? [])]);
      setProjectId(p.id);
      setError(null);
    } catch {
      setError(CREATE_FAILED);
    }
  }

  const shown = project && project.id === projectId ? project : null;
  const phase = shown ? runPhase(shown, run) : 'idle';
  const running = !!shown && (phase === 'running' || phase === 'paused');

  return (
    <div className="vf-pn">
      <header className="vf-pn-head">
        <span className="vf-pn-mark">〰 VidFlow</span>
        <button type="button" className="vf-pn-link" onClick={() => void openStudio(shown?.id).catch(() => undefined)}>
          Open full studio ↗
        </button>
      </header>

      {projects === null ? (
        <p className="vf-pn-label">Opening your videos…</p>
      ) : running && shown && run ? (
        <PanelRun
          project={shown}
          run={run}
          busy={busy}
          error={error}
          onPause={() => void act('pause', () => client.pause())}
          onResume={() => void act('resume', () => client.resume())}
          onStop={() => void act('stop', () => client.stop())}
        />
      ) : (
        <>
          <VideoPicker projects={projects} value={projectId} onPick={setProjectId} onCreate={create} />
          {shown ? (
            <PanelSetup
              key={shown.id}
              project={shown}
              run={run}
              busy={busy}
              error={error}
              onChange={change}
              onStart={() => void act('start', () => client.start(shown.id))}
              onReview={() => void openStudio(shown.id).catch(() => undefined)}
            />
          ) : (
            error && (
              <p className="vf-notice vf-pn-notice" role="alert">
                {error}
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

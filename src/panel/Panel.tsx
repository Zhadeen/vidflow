import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RunReply } from '../flow/messages';
import { healthLine } from '../runs/health';
import { isHeroSheetRun, isLive, type RunState } from '../runs/run';
import { createProject, getProject, listProjects, type Project } from '../store/projects';
import { runPhase } from '../studio/progress';
import { applyPatch, saveEdits } from '../studio/projectEdits';
import { openStudio } from '../studio/openStudio';
import type { RunClient } from '../studio/runClient';
import type { ProjectPatch } from '../studio/ScriptStep';
import { HealthLine } from './HealthLine';
import { PanelChecks, type ChecksResult } from './PanelChecks';
import { PanelQueue } from './PanelQueue';
import { PanelSetup, VideoPicker } from './PanelSetup';
import { panelId, tabId, Tabs, type PanelTab } from './Tabs';

type Summary = Pick<Project, 'id' | 'name' | 'updatedAt'>;
export type PanelBusy = null | 'start' | 'pause' | 'resume' | 'stop' | 'skip';

const LOAD_FAILED = "VidFlow couldn't load your videos. Close this panel and open it again.";
const SAVE_FAILED = "VidFlow couldn't save your last change. Check Chrome has free disk space, then make the change again.";
const REQUEST_FAILED = 'Something went wrong \u2014 try again.';
const CREATE_FAILED = "VidFlow couldn't make a new video. Check Chrome has free disk space, then try again.";

/**
 * VidFlow beside Flow (Chrome's side panel, spec §19): a health line, then Setup · Queue N · Checks · Files. It shows the
 * live run's video if there is one, otherwise the most recently opened; the picker switches it (kept in the panel only).
 * It opens on Queue while a run of scenes is live and on Setup otherwise, and follows a run as it starts and ends.
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
  const ids = useId();
  const [tab, setTab] = useState<PanelTab>('setup');
  const [checks, setChecks] = useState<ChecksResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkSeq = useRef(0);

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

  /** Reads VidFlow's Flow tab for this video (Checks tab and health line); a newer read wins over an older one. */
  const check = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckError(null);
    let reply: Awaited<ReturnType<RunClient['checks']>>;
    try {
      reply = await client.checks(id);
    } catch {
      reply = { ok: false, message: REQUEST_FAILED };
    }
    if (seq !== checkSeq.current) return;
    setChecking(false);
    if (current.current !== id) return;
    if (reply.ok) setChecks({ flowOpen: reply.flowOpen, rows: reply.rows, at: Date.now() });
    else setCheckError(reply.message);
  }, [client]);

  // On open and for each video picked.
  useEffect(() => {
    setChecks(null);
    if (projectId) void check();
  }, [projectId, check]);

  // When the run changes state (starts, pauses, ends), not on every scene it finishes.
  const runKey = run ? `${run.projectId}:${run.kind ?? 'scenes'}:${run.status}` : 'none';
  const loaded = projects !== null;
  const lastRunKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = lastRunKey.current;
    lastRunKey.current = runKey;
    if (before !== null && before !== runKey) void check();
  }, [runKey, loaded, check]);

  // Queue while a run of scenes is live, Setup otherwise: on opening, and whenever a run starts or ends.
  const scenesLive = !!run && isLive(run) && !isHeroSheetRun(run);
  const wasLive = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (wasLive.current === null ? scenesLive : wasLive.current !== scenesLive) setTab(scenesLive ? 'queue' : 'setup');
    wasLive.current = scenesLive;
  }, [scenesLive, loaded]);

  function pickTab(next: PanelTab) {
    setTab(next);
    if (next === 'checks') void check();
  }

  async function act(kind: PanelBusy, request: () => Promise<RunReply>) {
    setBusy(kind);
    setError(null);
    try {
      const reply = await request();
      if (reply.ok) setRun(reply.state);
      else setError(reply.message);
    } catch {
      setError(REQUEST_FAILED);
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
  const studio = () => void openStudio(shown?.id).catch(() => undefined);
  const health = !loaded ? null : !projectId ? [] : checks ? healthLine(checks.rows, checks.flowOpen) : checkError ? ['Flow not checked'] : null;
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'queue', label: shown ? `Queue ${shown.scenes.length}` : 'Queue' },
    { id: 'checks', label: 'Checks' },
    { id: 'files', label: 'Files' },
  ];

  return (
    <div className="vf-pn">
      <header className="vf-pn-head">
        <span className="vf-pn-mark">〰 VidFlow</span>
        <button type="button" className="vf-pn-link" onClick={studio}>
          Open full studio ↗
        </button>
      </header>
      <HealthLine items={health} />
      <Tabs idBase={ids} tabs={tabs} value={tab} onChange={pickTab} />

      <div className="vf-pn-body" role="tabpanel" id={panelId(ids, tab)} aria-labelledby={tabId(ids, tab)}>
        {projects === null ? (
          <p className="vf-pn-label">Opening your videos…</p>
        ) : tab === 'setup' ? (
          <>
            <VideoPicker projects={projects} value={projectId} onPick={setProjectId} onCreate={create} />
            {shown ? (
              <PanelSetup
                key={shown.id}
                project={shown}
                run={run}
                client={client}
                busy={busy}
                error={error}
                onChange={change}
                onRunState={setRun}
                onStart={() => void act('start', () => client.start(shown.id))}
                onReview={studio}
                onOpenStudio={studio}
                locked={running}
                onGoToQueue={() => pickTab('queue')}
              />
            ) : (
              error && (
                <p className="vf-notice vf-pn-notice" role="alert">
                  {error}
                </p>
              )
            )}
          </>
        ) : tab === 'queue' ? (
          shown ? (
            <PanelQueue
              key={shown.id}
              project={shown}
              run={run}
              client={client}
              busy={busy}
              error={error}
              onPause={() => void act('pause', () => client.pause())}
              onResume={() => void act('resume', () => client.resume())}
              onStop={() => void act('stop', () => client.stop())}
              onSkip={() => void act('skip', () => client.skip())}
              onStart={() => void act('start', () => client.start(shown.id))}
              onRunState={setRun}
              onSceneState={(sceneId, state) =>
                setProject((p) => (p && p.id === shown.id ? { ...p, sceneStates: { ...p.sceneStates, [sceneId]: state } } : p))
              }
            />
          ) : scenesLive ? null : (
            <p className="vf-pn-sub">Pick a video on Setup first.</p>
          )
        ) : tab === 'checks' ? (
          shown ? (
            <PanelChecks project={shown} client={client} result={checks} checking={checking} error={checkError} onCheck={() => void check()} />
          ) : (
            <p className="vf-pn-sub">Pick a video on Setup first.</p>
          )
        ) : (
          // Files: the next step.
          <p className="vf-pn-sub">Coming in the next step</p>
        )}
      </div>
    </div>
  );
}

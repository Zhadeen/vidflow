/// <reference types="chrome" />
import { useEffect, useState } from 'react';
import { liveView } from '../flow/live';
import { pillProgress } from '../flow/pill';
import { sceneNumber, STEP_KEY, type Step } from '../runs/activity';
import type { RunState } from '../runs/run';
import type { Project, SceneState } from '../store/projects';
import { ActivityList } from '../studio/ActivityList';
import { Button } from '../studio/Button';
import { ownerPauseReason } from '../studio/progress';
import type { PanelBusy } from './Panel';

/** The step VidFlow is on now (as the Flow pill reads it), kept up to date. */
function useStep(): Step | null {
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return; // outside the extension (screenshots)
    let alive = true;
    chrome.storage.local.get(STEP_KEY).then(
      (got) => alive && setStep((got[STEP_KEY] as Step | undefined) ?? null),
      () => undefined,
    );
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && STEP_KEY in changes) setStep((changes[STEP_KEY]!.newValue as Step | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return step;
}

type Tile = 'saved' | 'current' | 'drawing' | 'attention' | 'upcoming';

function tileState(s: SceneState, current: boolean): Tile {
  if (s.status === 'done') return 'saved';
  if (current) return 'current';
  if (s.status === 'refused' || s.status === 'failed') return 'attention';
  if (s.status === 'submitted') return 'drawing';
  return 'upcoming';
}

interface Props {
  project: Project;
  run: RunState;
  busy: PanelBusy;
  error: string | null;
  /** For screenshots, which run outside the extension. */
  step?: Step | null;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

/** While it runs: the step, progress, the scene strip and the newest activity, with Pause/Resume and Stop. */
export function PanelRun({ project, run, busy, error, step: stepProp, onPause, onResume, onStop }: Props) {
  const stored = useStep();
  const step = stepProp !== undefined ? stepProp : stored;
  const view = liveView(run, step, project);
  const paused = run.status === 'paused';
  const pauseReason = ownerPauseReason(project, run);
  // The scene VidFlow is working on now (a paused run isn't working on any).
  const currentId = !paused && step && step.projectId === run.projectId ? step.sceneId : null;
  const inRun = project.scenes.filter((s) => s.id in run.sceneStates);
  const needLook = inRun.filter((s) => ['refused', 'failed'].includes(run.sceneStates[s.id]!.status)).length;

  const line = paused
    ? 'Paused · press Resume to carry on'
    : view?.step
      ? view.scene !== null
        ? `Scene ${view.scene} of ${view.total} · ${view.step}`
        : view.step
      : `Picture ${view?.n ?? 0} of ${view?.total ?? 0}`;
  const percent = view ? pillProgress(view) : 0;

  return (
    <>
      <div>
        <b className="vf-pn-name">{project.name}</b>
        <div className="vf-pn-sub">{line}</div>
      </div>
      <div className="vf-pn-track" role="progressbar" aria-label="Pictures made" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="vf-pn-fill" style={{ width: `${percent}%` }} />
      </div>
      {view && (
        <div className="vf-pn-sub">
          {view.saved} saved · {view.drawing} being drawn · {view.toGo} to go
          {needLook > 0 ? ` · ${needLook} ${needLook === 1 ? 'needs' : 'need'} a look` : ''}
        </div>
      )}
      <ol className="vf-pn-strip" aria-label="Scenes">
        {inRun.map((s) => {
          const state = tileState(run.sceneStates[s.id]!, s.id === currentId);
          const n = sceneNumber(project, s.id);
          return (
            <li key={s.id} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'saved' ? `✓${n}` : n}
            </li>
          );
        })}
      </ol>

      <div className="vf-pn-activity">
        <ActivityList projectId={project.id} project={project} limit={5} showSwitch={false} />
      </div>

      {pauseReason && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {pauseReason}
        </p>
      )}
      {error && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {error}
        </p>
      )}

      <div className="vf-pn-actions vf-pn-end">
        {paused ? (
          <Button variant="primary" onClick={onResume} loading={busy === 'resume'} disabled={busy === 'stop'}>
            Resume
          </Button>
        ) : (
          <Button variant="primary" onClick={onPause} loading={busy === 'pause'} disabled={busy === 'stop'}>
            Pause
          </Button>
        )}
        <Button onClick={onStop} loading={busy === 'stop'} disabled={busy !== null && busy !== 'stop'}>
          Stop
        </Button>
      </div>
    </>
  );
}

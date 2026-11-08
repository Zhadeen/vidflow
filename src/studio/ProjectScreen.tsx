import { useEffect, useState } from 'react';
import type { RunState } from '../runs/run';
import type { MediaStore } from '../store/media';
import type { Project, SceneState } from '../store/projects';
import { MotionStep } from './MotionStep';
import { PicturesStep } from './PicturesStep';
import { pictureProgress, runPhase } from './progress';
import type { RunClient } from './runClient';
import { ScriptStep, type ProjectPatch } from './ScriptStep';
import { StepBar, type StepId, type StepView } from './StepBar';

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  media: MediaStore;
  initialStep?: Screen;
  onChange(patch: ProjectPatch): void;
  onHome(): void;
  /** The run as the background reported it after a request from this screen. */
  onRunState?(state: RunState | null): void;
  /** One scene's state as saved, read back after the owner swaps its picture. */
  onSceneState?(sceneId: string, state: SceneState): void;
  /** Resolves once the edits made so far are saved (Make clips waits for the Motion choice and picks). */
  onFlush?(): Promise<unknown>;
}

type Screen = 'script' | 'pictures' | 'motion';

/** Why the Motion step can't be opened yet (the step bar's tooltip and Continue to Motion's reason). */
export const MOTION_WAITS = 'Motion opens once a slide has its picture.';

export function ProjectScreen({ project, run: runProp, client, media, initialStep, onChange, onHome, onRunState, onSceneState, onFlush }: Props) {
  const [step, setStep] = useState<Screen>(initialStep ?? (project.scenes.length > 0 ? 'pictures' : 'script'));
  const [run, setRun] = useState(runProp);
  useEffect(() => setRun(runProp), [runProp]);

  const reportRun = (state: RunState | null) => {
    setRun(state);
    onRunState?.(state);
  };

  function change(patch: ProjectPatch) {
    onChange(patch);
    // New scenes: a finished run for the old ones must not come back (the background forgets it).
    if (patch.scenes) void client.forget(project.id).then((reply) => reply.ok && reportRun(reply.state));
  }

  const phase = runPhase(project, run);
  const progress = pictureProgress(project, run);
  const hasScenes = project.scenes.length > 0;
  const live = phase === 'running' || phase === 'paused';
  const motionReady = hasScenes && progress.done > 0;
  const counting = hasScenes && (live || phase === 'finished' || progress.done > 0 || step === 'pictures');

  const steps: StepView[] = [
    { id: 'script', label: 'Script', done: hasScenes, comingNext: false, enabled: true },
    { id: 'voice', label: 'Voice', done: false, comingNext: true, enabled: false },
    {
      id: 'pictures',
      label: 'Pictures',
      count: counting ? `${progress.done}/${progress.total}` : undefined,
      done: hasScenes && progress.done === progress.total,
      comingNext: false,
      enabled: hasScenes,
    },
    // Motion (spec §20): open once some slide has its picture.
    { id: 'motion', label: 'Motion', done: false, comingNext: false, enabled: motionReady, ...(motionReady ? {} : { reason: MOTION_WAITS }) },
    { id: 'edit', label: 'Edit', done: false, comingNext: true, enabled: false },
    { id: 'export', label: 'Export', done: false, comingNext: true, enabled: false },
  ];

  return (
    <div className="vf-shell">
      <header className="vf-header">
        <button type="button" className="vf-wordmark" onClick={onHome} aria-label="VidFlow — back to your videos">
          〰 VidFlow
        </button>
        <h1 className="vf-project-name">{project.name}</h1>
      </header>
      <StepBar
        steps={steps}
        active={step}
        onSelect={(id: StepId) => (id === 'script' || id === 'pictures' || id === 'motion') && setStep(id)}
      />
      {step === 'script' ? (
        <ScriptStep
          project={project}
          locked={live}
          hasPictures={progress.done > 0}
          onChange={change}
          onContinue={() => setStep('pictures')}
          sheet={{ run, client, onRunState: reportRun }}
        />
      ) : step === 'motion' ? (
        <MotionStep project={project} run={run} client={client} media={media} onChange={change} onRunState={reportRun} flush={onFlush} />
      ) : (
        <PicturesStep
          project={project}
          run={run}
          client={client}
          media={media}
          onRunState={reportRun}
          onSceneState={onSceneState}
          onContinue={() => setStep('motion')}
          motionWaits={motionReady ? null : MOTION_WAITS}
        />
      )}
    </div>
  );
}

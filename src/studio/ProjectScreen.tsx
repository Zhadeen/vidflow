import { useEffect, useState } from 'react';
import type { RunState } from '../runs/run';
import type { MediaStore } from '../store/media';
import type { Project } from '../store/projects';
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
  initialStep?: 'script' | 'pictures';
  onChange(patch: ProjectPatch): void;
  onHome(): void;
}

export function ProjectScreen({ project, run: runProp, client, media, initialStep, onChange, onHome }: Props) {
  const [step, setStep] = useState<'script' | 'pictures'>(initialStep ?? (project.scenes.length > 0 ? 'pictures' : 'script'));
  const [run, setRun] = useState(runProp);
  useEffect(() => setRun(runProp), [runProp]);

  const phase = runPhase(project, run);
  const progress = pictureProgress(project, run);
  const hasScenes = project.scenes.length > 0;
  const live = phase === 'running' || phase === 'paused';
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
    { id: 'motion', label: 'Motion', done: false, comingNext: true, enabled: false },
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
      <StepBar steps={steps} active={step} onSelect={(id: StepId) => (id === 'script' || id === 'pictures') && setStep(id)} />
      {step === 'script' ? (
        <ScriptStep
          project={project}
          locked={live}
          hasPictures={progress.done > 0}
          onChange={onChange}
          onContinue={() => setStep('pictures')}
        />
      ) : (
        <PicturesStep project={project} run={run} client={client} media={media} onRunState={setRun} />
      )}
    </div>
  );
}

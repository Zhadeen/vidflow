import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import type { RunReply } from '../flow/messages';
import type { RunState } from '../runs/run';
import type { MediaStore } from '../store/media';
import { getProject, type Project, type SceneState } from '../store/projects';
import { ActivityList } from './ActivityList';
import { choosePicture } from './choice';
import { chosenPicture, hasChoice } from './chosen';
import { Button } from './Button';
import { ownerPauseReason, pictureProgress, runPhase, sceneNumber, sceneStatesFor } from './progress';
import type { RunClient } from './runClient';
import { SceneGrid, Timeline, aspectCss } from './SceneGrid';
import { usePictureUrls } from './usePictureUrls';

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  media: MediaStore;
  /** The run as the background reported it after a request. */
  onRunState(state: RunState | null): void;
  /** One scene's state as saved, read back after a swap (with no run live the background sends no broadcast). */
  onSceneState?(sceneId: string, state: SceneState): void;
}

type Busy = null | 'start' | 'pause' | 'resume' | 'stop' | `retry:${string}`;

const MOTION_NEXT = 'Motion is coming next in VidFlow. Your pictures are saved in this project.';
const SWAP_HINT = "VidFlow uses Flow's first picture. Click another to swap.";
const SWAP_FAILED = "VidFlow couldn't save that choice. Try again.";

export function PicturesStep({ project, run, client, media, onRunState, onSceneState }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [motionNote, setMotionNote] = useState(false);
  // Swaps shown at once, before the background confirms them; each goes once the saved state agrees (or it fails).
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [swapping, setSwapping] = useState(false);
  // Where focus goes once a swap settles: the newly chosen card, or back to the button that was pressed.
  const [focusTo, setFocusTo] = useState<{ pictureId: string; on: 'card' | 'button' } | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const phase = runPhase(project, run);
  const saved = useMemo(() => sceneStatesFor(project, run), [project, run]);
  const states = useMemo(() => {
    const out = { ...saved };
    for (const [sceneId, pictureId] of Object.entries(swaps)) {
      if (out[sceneId]) out[sceneId] = { ...out[sceneId], chosenPictureId: pictureId };
    }
    return out;
  }, [saved, swaps]);

  useEffect(() => {
    const confirmed = Object.keys(swaps).filter((id) => chosenPicture(saved[id]) === swaps[id]);
    if (confirmed.length === 0) return;
    setSwaps((now) => {
      const next = { ...now };
      for (const id of confirmed) if (next[id] === swaps[id]) delete next[id];
      return next;
    });
  }, [saved, swaps]);
  const progress = pictureProgress(project, run);
  const pauseReason = ownerPauseReason(project, run);

  const autoScene = useMemo(() => {
    const done = project.scenes.filter((s) => states[s.id].status === 'done');
    return (done[done.length - 1] ?? project.scenes[0])?.id ?? null;
  }, [project.scenes, states]);
  const shownId = picked ?? autoScene;
  const shown = project.scenes.find((s) => s.id === shownId) ?? null;
  const shownState: SceneState | undefined = shownId ? states[shownId] : undefined;

  const wanted = useMemo(() => {
    const ids = project.scenes.map((s) => chosenPicture(states[s.id])).filter((id): id is string => !!id);
    for (const id of shownState?.pictureIds ?? []) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [project.scenes, states, shownState]);
  const urls = usePictureUrls(media, wanted);

  const remaining = project.scenes.filter((s) => states[s.id].status !== 'done' && states[s.id].status !== 'refused').length;
  const needLook = [...progress.refused, ...progress.failed];

  async function act(kind: Busy, request: () => Promise<RunReply>) {
    setBusy(kind);
    setError(null);
    try {
      const reply = await request();
      if (reply.ok) onRunState(reply.state);
      else setError(reply.message);
    } finally {
      setBusy(null);
    }
  }

  const start = () => act('start', () => client.start(project.id));
  const pause = () => act('pause', () => client.pause());
  const resume = () => act('resume', () => client.resume());
  const stop = () => act('stop', () => client.stop());
  const retry = (sceneId: string) => act(`retry:${sceneId}`, () => client.retry(project.id, sceneId));

  useEffect(() => {
    if (!focusTo || swapping) return;
    const card = [...(optionsRef.current?.querySelectorAll<HTMLElement>('figure') ?? [])].find((f) => f.dataset.pictureId === focusTo.pictureId);
    const target = focusTo.on === 'card' ? card : card?.querySelector<HTMLElement>('button');
    target?.focus();
    setFocusTo(null);
  }, [focusTo, swapping, states]);

  /** One click: the pill moves now; the background (the single writer) saves it; a refusal puts it back and says why. */
  async function swap(sceneId: string, pictureId: string) {
    if (swapping || chosenPicture(states[sceneId]) === pictureId) return;
    setSwapping(true);
    setError(null);
    setSwaps((now) => ({ ...now, [sceneId]: pictureId }));
    try {
      await choosePicture(project.id, sceneId, pictureId, client);
    } catch (e) {
      setSwaps((now) => {
        const next = { ...now };
        delete next[sceneId];
        return next;
      });
      setError(e instanceof Error && e.message ? e.message : SWAP_FAILED);
      setFocusTo({ pictureId, on: 'button' });
      setSwapping(false);
      return;
    }
    setFocusTo({ pictureId, on: 'card' });
    try {
      // Saved. Read it back: with no run live there is no broadcast to bring it; with one, the run has it too.
      const fresh = await getProject(project.id);
      // Only this scene: anything else in the stored project is not this swap's to bring in.
      const scene = fresh?.sceneStates[sceneId];
      if (scene) onSceneState?.(sceneId, scene);
      if (phase === 'running' || phase === 'paused') {
        const reply = await client.get();
        if (reply.ok) onRunState(reply.state);
      }
    } catch {
      // The choice is saved; the next refresh shows it. The swap already shows here.
    } finally {
      setSwapping(false);
    }
  }

  const showBeforeStart = phase === 'idle' && picked === null && remaining > 0;

  return (
    <div className="vf-stack">
      <div className="vf-editor">
        <section className="vf-preview" aria-label="Preview">
          {showBeforeStart ? (
            <BeforeStart scenes={remaining} total={project.scenes.length} perScene={project.outputsPerPrompt} />
          ) : (
            shown && (
              <Options
                ref={optionsRef}
                project={project}
                state={shownState}
                urls={urls}
                busy={swapping}
                onUse={(pictureId) => void swap(shown.id, pictureId)}
              />
            )
          )}
          {shown && !showBeforeStart && (
            <p className="vf-status">
              Scene {sceneNumber(project, shown.id)}
              {shown.sentence ? ` · "${shown.sentence}"` : ''}
              {statusTail(phase, shownState)}
            </p>
          )}
          {shown && !showBeforeStart && (shownState?.pictureIds.length ?? 0) > 1 && !project.scenes.some((s) => hasChoice(states[s.id])) && (
            <p className="vf-hint vf-swap-hint">{SWAP_HINT}</p>
          )}
          {shown && !showBeforeStart && (
            <p role="status" className="vf-visually-hidden">
              {usingLine(shownState)}
            </p>
          )}
        </section>

        <aside className="vf-grid-panel" aria-label="Scenes">
          <div className="vf-grid-head">
            <strong>Scenes</strong>
            <span>
              {progress.done} of {progress.total} ready
            </span>
          </div>
          <SceneGrid
            scenes={project.scenes}
            states={states}
            urls={urls}
            aspect={project.aspect}
            selected={showBeforeStart ? null : shownId}
            onSelect={setPicked}
          />
        </aside>
      </div>

      <Timeline scenes={project.scenes} states={states} selected={showBeforeStart ? null : shownId} onSelect={setPicked} />

      <ActivityList projectId={project.id} project={project} />

      {pauseReason && (
        <p className="vf-notice" role="alert">
          {pauseReason}
        </p>
      )}
      {error && (
        <p className="vf-notice" role="alert">
          {error}
        </p>
      )}

      {phase === 'finished' && (
        <p className="vf-status">
          <strong>Finished.</strong> {progress.done} done · {progress.refused.length} refused · {progress.failed.length} failed.
        </p>
      )}

      {needLook.length > 0 && (
        <section aria-label="Scenes that need a look" className="vf-stack" style={{ gap: 'var(--vf-space-2)' }}>
          <h2 className="vf-h2">
            {needLook.length === 1 ? '1 scene needs a look' : `${needLook.length} scenes need a look`}
          </h2>
          <ul className="vf-attention">
            {needLook.map((id) => {
              const s = states[id];
              return (
                <li key={id}>
                  <div>
                    <p className="vf-what">
                      Scene {sceneNumber(project, id)} · {s.status === 'refused' ? 'Flow refused it' : "It didn't work"}
                    </p>
                    <p className="vf-why">{s.message ?? 'No reason was given.'}</p>
                  </div>
                  <Button small onClick={() => void retry(id)} loading={busy === `retry:${id}`} disabled={busy !== null && busy !== `retry:${id}`}>
                    Try again
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="vf-actions">
        {phase === 'paused' ? (
          <Button variant="primary" onClick={() => void resume()} loading={busy === 'resume'} disabled={busy === 'stop'}>
            Resume
          </Button>
        ) : phase === 'idle' && remaining > 0 ? (
          <Button variant="primary" onClick={() => void start()} loading={busy === 'start'}>
            Start making pictures
          </Button>
        ) : (
          // Motion isn't built yet: the owner kept this coral (approved look); pressing it says so instead of moving on.
          <Button variant="primary" aria-disabled="true" aria-describedby="vf-motion-next" onClick={() => setMotionNote(true)}>
            Continue to Motion →
          </Button>
        )}
        {phase === 'running' && (
          <Button onClick={() => void pause()} loading={busy === 'pause'}>
            Pause
          </Button>
        )}
        {phase === 'paused' && (
          <Button onClick={() => void stop()} loading={busy === 'stop'} disabled={busy === 'resume'}>
            Stop
          </Button>
        )}
      </div>
      {phase === 'paused' && (
        <p className="vf-hint">Stop ends this run and keeps every picture. Start carries on later from the first scene without one.</p>
      )}
      <p className="vf-hint" id="vf-motion-next" aria-live="polite">
        {motionNote ? MOTION_NEXT : ''}
      </p>
    </div>
  );
}

function statusTail(phase: ReturnType<typeof runPhase>, state: SceneState | undefined): string {
  const status = state?.status ?? 'pending';
  if (status === 'refused' || status === 'failed') return ' — needs a look. See below.';
  if (phase === 'running') {
    if (status === 'done') return ' — Flow is making the rest. You can leave this tab.';
    if (status === 'submitted') return ' — Flow is making this one now. You can leave this tab.';
    return ' — waiting its turn. You can leave this tab.';
  }
  if (phase === 'paused') return ' — paused. Press Resume to carry on.';
  if (status === 'pending') return ' — no pictures yet.';
  return '';
}

function BeforeStart({ scenes, total, perScene }: { scenes: number; total: number; perScene: number }) {
  const pictures = scenes * perScene;
  return (
    <div className="vf-panel vf-before-start">
      <p className="vf-big-number">
        {scenes === total ? `${scenes} ${scenes === 1 ? 'scene' : 'scenes'}` : `${scenes} of ${total} scenes left`} · {pictures}{' '}
        {pictures === 1 ? 'picture' : 'pictures'}
      </p>
      <p className="vf-hint" style={{ margin: 0 }}>
        Flow makes {perScene} {perScene === 1 ? 'picture' : 'pictures'} for each scene. Before you start:
      </p>
      <ul className="vf-facts">
        <li>Pictures cost 0 Flow credits on your plan.</li>
        <li>A separate Flow window opens. Leave it open while VidFlow works.</li>
        <li>
          While it runs, Chrome shows a bar saying "VidFlow started debugging this browser". That is VidFlow pressing
          Generate for you.
        </li>
        <li>You can leave this tab and use your Mac. VidFlow tells you when the pictures are ready.</li>
      </ul>
    </div>
  );
}

/** "Using option 2 of 3" for screen readers; nothing while the scene has no pictures. */
function usingLine(state: SceneState | undefined): string {
  const inUse = chosenPicture(state);
  if (!state || !inUse) return '';
  return `Using option ${state.pictureIds.indexOf(inUse) + 1} of ${state.pictureIds.length}`;
}

export interface OptionsProps {
  ref?: Ref<HTMLDivElement>;
  project: Project;
  state: SceneState | undefined;
  urls: Record<string, string>;
  /** A swap is being saved: the other cards wait. */
  busy: boolean;
  onUse(pictureId: string): void;
}

export function Options({ ref, project, state, urls, busy, onUse }: OptionsProps) {
  const ids = state?.pictureIds ?? [];
  const count = ids.length > 0 ? ids.length : project.outputsPerPrompt;
  const inUse = chosenPicture(state);
  const empty =
    state?.status === 'submitted' ? 'Flow is making this…' : state?.status === 'refused' || state?.status === 'failed' ? 'No picture' : 'Not made yet';
  const titleId = useId();
  return (
    <div className="vf-options" ref={ref}>
      {Array.from({ length: count }, (_, i) => {
        const id = ids[i];
        const url = id ? urls[id] : undefined;
        const chosen = !!id && id === inUse;
        const other = !!id && !chosen;
        // The whole other card is clickable; its "Use this picture" button is the keyboard stop (Enter / Space).
        const onClick = other && !busy ? () => onUse(id) : undefined;
        return (
          <figure
            key={id ?? i}
            className="vf-option"
            aria-labelledby={`${titleId}-${i}`}
            data-best={chosen || undefined}
            data-swap={other || undefined}
            data-picture-id={id}
            aria-current={chosen || undefined}
            tabIndex={chosen ? -1 : undefined}
            onClick={onClick}
          >
            {chosen && <span className="vf-best">★ Using this</span>}
            <span
              className={`vf-option-frame${url ? '' : ' vf-option-frame-empty'}`}
              style={{ aspectRatio: aspectCss(project.aspect) }}
            >
              {url ? (
                <img src={url} alt={`Option ${i + 1} of ${count}`} />
              ) : (
                <span className={state?.status === 'submitted' ? 'vf-working' : undefined}>{empty}</span>
              )}
            </span>
            <figcaption>
              <span className="vf-option-title" id={`${titleId}-${i}`}>
                Option {i + 1} of {count}
              </span>
              {other && (
                <Button small className="vf-option-use" disabled={busy} aria-describedby={`${titleId}-${i}`}>
                  Use this picture
                </Button>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

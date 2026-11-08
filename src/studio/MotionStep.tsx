import { useId, useMemo, useState } from 'react';
import { CLIP_ASPECT_MESSAGE, type RunReply } from '../flow/messages';
import { liveView } from '../flow/live';
import { pillLine } from '../flow/pill';
import { estimate } from '../motion/clips';
import { LIMIT_ZERO_MESSAGE, useClipLimit } from '../motion/useClipLimit';
import {
  clipMark,
  estimateLine,
  MOTION_CHOICES,
  motionPauseReason,
  motionRunFor,
  pausedOnSlide,
  togglePick,
} from '../motion/view';
import { isClipRun, isHeroSheetRun, isLive, type RunState } from '../runs/run';
import type { MediaStore } from '../store/media';
import type { Project, SceneState } from '../store/projects';
import { Button } from './Button';
import { chosenPicture } from './chosen';
import { SAVE_FAILED_MESSAGE } from './projectEdits';
import { runPhase, sceneStatesFor } from './progress';
import type { RunClient } from './runClient';
import { aspectCss } from './SceneGrid';
import type { ProjectPatch } from './ScriptStep';
import { usePictureUrls } from './usePictureUrls';

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  media: MediaStore;
  onChange(patch: ProjectPatch): void;
  /** The run as the background reported it after a request. */
  onRunState(state: RunState | null): void;
  /** Resolves once this screen's edits are saved (the background reads the Motion choice and picks from the store). */
  flush?(): Promise<unknown>;
}

type Busy = null | 'clips' | 'pause' | 'resume' | 'stop' | 'skip';

const REQUEST_FAILED = 'Something went wrong — try again.';

/**
 * The studio's Motion step (spec §20): the same choice as the panel's Setup (Stills only / Clips for the slides I pick
 * / Clips for every slide), clips · credits needed · credits left, the credit limit, a grid of slides with their Clip
 * ticks and clip marks, and the coral Make clips (N credits). While a Motion run is live: its progress, Pause/Resume,
 * Stop and Skip.
 */
export function MotionStep({ project, run, client, media, onChange, onRunState, flush }: Props) {
  const ids = useId();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const states = useMemo(() => sceneStatesFor(project, run), [project, run]);
  const mode = project.motionMode ?? 'stills';
  const square = project.aspect === '1:1';
  const clipsOn = mode !== 'stills' && !square;
  const picking = mode === 'picked' && !square;
  const picks = new Set(project.clipPicks ?? []);
  const needed = estimate(project, states);
  const limit = useClipLimit(needed.credits);

  const mine = motionRunFor(project, run);
  const motionOn = !!mine && (mine.status === 'running' || mine.status === 'paused');
  const clipRun = motionOn && isClipRun(mine) ? mine : null;
  const paused = motionOn && mine!.status === 'paused';
  const picturesLive = (() => {
    const phase = runPhase(project, run);
    return phase === 'running' || phase === 'paused';
  })();
  const pausedOn = pausedOnSlide(project, run);
  const pauseReason = motionPauseReason(project, run);

  const wanted = useMemo(
    () => project.scenes.map((s) => chosenPicture(states[s.id])).filter((id): id is string => !!id),
    [project.scenes, states],
  );
  const urls = usePictureUrls(media, wanted);

  async function act(kind: Busy, request: () => Promise<RunReply>) {
    setBusy(kind);
    setError(null);
    try {
      const reply = await request();
      if (reply.ok) onRunState(reply.state);
      else setError(reply.message);
    } catch {
      setError(REQUEST_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function make() {
    // The background reads the Motion choice and picks from the store: a failed save stops here, nothing is spent.
    try {
      await flush?.();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : SAVE_FAILED_MESSAGE);
      return;
    }
    await act('clips', () => client.makeClips(project.id, limit.value));
  }

  // Why Make clips waits (it stays the one coral on this screen).
  const why =
    square
      ? CLIP_ASPECT_MESSAGE
      : mode === 'stills'
        ? 'Choose clips above to make clips. Stills only spends no credits.'
        : picturesLive
          ? 'Make clips once VidFlow has finished making pictures.'
          : isLive(run)
            ? isHeroSheetRun(run)
              ? 'Make clips once the model sheet is made.'
              : 'Make clips once the run going now has finished or is stopped.'
            : needed.clips === 0
              ? mode === 'picked' && picks.size === 0
                ? 'Tick the slides that get a clip.'
                : 'Every chosen slide has an up-to-date clip.'
              : limit.value <= 0
                ? LIMIT_ZERO_MESSAGE
                : null;
  const whyId = `${ids}-why`;
  const view = motionOn && run ? liveView(run, null, project) : null;
  const progressLine = view
    ? `${paused ? 'Paused · press Resume to carry on' : pillLine(view)}${clipRun ? ` · ${clipRun.spent ?? 0} of ${clipRun.limit ?? 0} credits used` : ''}`
    : null;

  return (
    <div className="vf-stack">
      <section className="vf-panel vf-stack vf-motion" aria-label="Motion choice">
        <fieldset className="vf-seg" role="radiogroup" aria-label="Motion" disabled={motionOn}>
          <div className="vf-seg-options vf-motion-options">
            {MOTION_CHOICES.map((c) => {
              const off = square && c.value !== 'stills';
              return (
                <label key={c.value} className="vf-seg-option">
                  <input
                    type="radio"
                    name={`${ids}-motion`}
                    checked={mode === c.value}
                    disabled={off}
                    aria-describedby={off ? `${ids}-square` : undefined}
                    onChange={() => onChange({ motionMode: c.value })}
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {square && (
          <p className="vf-hint" id={`${ids}-square`}>
            {CLIP_ASPECT_MESSAGE}
          </p>
        )}
        <p className="vf-status" aria-live="polite">
          {estimateLine(project, states, run)}
        </p>
        {clipsOn && (
          <label className="vf-motion-limit">
            <span className="vf-label">Credit limit for this run</span>
            <input
              type="number"
              className="vf-input"
              min={0}
              max={needed.credits}
              step={1}
              inputMode="numeric"
              value={limit.text}
              disabled={motionOn}
              onChange={(e) => limit.onChange(e.target.value)}
              onBlur={limit.onBlur}
            />
          </label>
        )}
        <p className="vf-hint">
          VidFlow stops before a clip that would pass the limit or your Flow credits. Every slide without a clip keeps its
          picture.
        </p>
      </section>

      <section className="vf-grid-panel vf-motion-grid" aria-label="Slides for clips">
        <div className="vf-grid-head">
          <strong>Slides</strong>
          {picking && (
            <span className="vf-row">
              <Button small onClick={() => onChange({ clipPicks: project.scenes.map((s) => s.id) })}>
                Pick all
              </Button>
              <Button small onClick={() => onChange({ clipPicks: [] })}>
                Pick none
              </Button>
            </span>
          )}
        </div>
        <ol className="vf-tiles" aria-label="Slides">
          {project.scenes.map((scene, i) => {
            const s = states[scene.id];
            const r = clipRun?.sceneStates[scene.id];
            const shown: SceneState | undefined =
              s && r?.status === 'done' && r.clip
                ? { ...s, clip: r.clip, clipNote: undefined }
                : s && (r?.status === 'failed' || r?.status === 'refused')
                  ? { ...s, clipNote: r.message }
                  : s;
            const n = String(i + 1).padStart(2, '0');
            const picture = chosenPicture(s);
            const url = picture ? urls[picture] : undefined;
            const mark = r?.status === 'submitted' ? 'Making clip…' : r?.status === 'pending' ? 'Clip waiting' : clipMark(shown);
            return (
              <li key={scene.id}>
                <div className="vf-tile vf-clip-tile" data-status={s?.status ?? 'pending'} data-making={r?.status === 'submitted' || undefined}>
                  <span className="vf-tile-frame" style={{ aspectRatio: aspectCss(project.aspect) }}>
                    {url ? <img src={url} alt={`Slide ${n}`} /> : <span>{picture ? '' : 'No picture yet'}</span>}
                  </span>
                  <span className="vf-tile-label">
                    <span>{n}</span>
                    {picking && (
                      <label className="vf-clip-tick">
                        <input
                          type="checkbox"
                          aria-label={`Clip for slide ${i + 1}`}
                          checked={picks.has(scene.id)}
                          disabled={motionOn}
                          onChange={(e) => onChange({ clipPicks: togglePick(project, scene.id, e.target.checked) })}
                        />
                        <span aria-hidden="true">Clip</span>
                      </label>
                    )}
                  </span>
                  {mark && <span className="vf-clip-mark">{mark}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {progressLine && (
        <p className="vf-status" role="status">
          {progressLine}
        </p>
      )}
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

      <div className="vf-actions">
        {motionOn ? (
          <>
            {paused ? (
              <Button variant="primary" onClick={() => void act('resume', () => client.resume())} loading={busy === 'resume'} disabled={busy === 'stop'}>
                Resume
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void act('pause', () => client.pause())} loading={busy === 'pause'} disabled={busy === 'stop'}>
                Pause
              </Button>
            )}
            <Button onClick={() => void act('stop', () => client.stop())} loading={busy === 'stop'} disabled={busy !== null && busy !== 'stop'}>
              Stop
            </Button>
            <Button
              onClick={() => void act('skip', () => client.skip())}
              loading={busy === 'skip'}
              disabled={(paused && pausedOn === null) || (busy !== null && busy !== 'skip')}
            >
              {pausedOn !== null ? `Skip slide ${pausedOn}` : 'Skip'}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => void make()}
            loading={busy === 'clips'}
            disabled={why !== null}
            aria-describedby={why !== null ? whyId : undefined}
          >
            Make clips ({needed.credits} {needed.credits === 1 ? 'credit' : 'credits'})
          </Button>
        )}
      </div>
      {!motionOn && why && (
        <p className="vf-hint" id={whyId}>
          {why}
        </p>
      )}
    </div>
  );
}

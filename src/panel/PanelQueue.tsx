/// <reference types="chrome" />
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { RunReply } from '../flow/messages';
import { liveView } from '../flow/live';
import { sceneNumber, STEP_KEY, type Step } from '../runs/activity';
import { isHeroSheetRun, isLive, type RunState } from '../runs/run';
import type { Scene } from '../scenes/types';
import type { MediaStore } from '../store/media';
import { getMediaStore, getProject, type Project, type SceneState } from '../store/projects';
import { ActivityList } from '../studio/ActivityList';
import { Button } from '../studio/Button';
import { choosePicture } from '../studio/choice';
import { chosenPicture } from '../studio/chosen';
import { Options } from '../studio/PicturesStep';
import { ownerPauseReason, runPhase, sceneStatesFor } from '../studio/progress';
import type { RunClient } from '../studio/runClient';
import { usePictureUrls } from '../studio/usePictureUrls';
import type { PanelBusy } from './Panel';

/** The upgrade marks of one scene (spec §19): only the true ones are shown. */
export function sceneMarks(state: SceneState | undefined, _project: Project): { checked: boolean; hero: boolean; options: number } {
  const done = state?.status === 'done';
  const options = state?.pictureIds.length ?? 0;
  // Every saved picture was checked against its prompt in Flow's detail view before it was saved. "hero ✓" is what
  // was true when the pictures were made (the reference attached in Flow), not what the hero is now.
  return { checked: done && options > 0, hero: done && state?.withHero === true, options };
}

type Filter = 'all' | 'drawing' | 'togo' | 'failed' | 'done';
type Kind = Exclude<Filter, 'all'>;

const kindOf = (s: SceneState): Kind =>
  s.status === 'done' ? 'done' : s.status === 'submitted' ? 'drawing' : s.status === 'pending' ? 'togo' : 'failed';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'togo', label: 'To go' },
  { id: 'failed', label: 'Failed' },
  { id: 'done', label: 'Done' },
];

/** Rows whose thumbnails are read before the browser says which are on screen (and in jsdom). */
const FIRST_ROWS = 30;
const SWAP_FAILED = "VidFlow couldn't save that choice. Try again.";
const REQUEST_FAILED = 'Something went wrong — try again.';

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
/** "00:21–00:24", or null when the scene has no timecode. */
function timecode(scene: Scene): string | null {
  if (scene.start === null || scene.end === null) return null;
  return `${clock(scene.start)}–${clock(scene.end)}`;
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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

/**
 * Which rows have been on screen (null until the browser says, or where it can't). One observer for the whole list.
 * A row that scrolls away keeps its thumbnail (no reload or flicker when it comes back); only rows seen are read.
 */
function useSeenRows(list: RefObject<HTMLUListElement | null>, rowsKey: string): Set<string> | null {
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const all = useRef(new Set<string>());
  useEffect(() => {
    const el = list.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.scene;
          if (id && e.isIntersecting && !all.current.has(id)) {
            all.current.add(id);
            added = true;
          }
        }
        // The first report always lands (even with nothing on screen), so the fallback rows stop being read.
        setSeen((before) => (added || !before ? new Set(all.current) : before));
      },
      { rootMargin: '200px 0px' },
    );
    el.querySelectorAll('li[data-scene]').forEach((li) => io.observe(li));
    return () => io.disconnect();
  }, [list, rowsKey]);
  return seen;
}

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  busy: PanelBusy;
  error: string | null;
  /** For screenshots, which run outside the extension. */
  step?: Step | null;
  media?: MediaStore;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onSkip(): void;
  onStart(): void;
  /** The run as the background reported it after a request (▶ Run, Retry failed, a swap during a run). */
  onRunState(state: RunState | null): void;
  /** One scene's state as saved, read back after a swap (with no run live the background sends no broadcast). */
  onSceneState(sceneId: string, state: SceneState): void;
}

/**
 * The Queue tab (spec §19): the video's progress, filters, one row per scene with its upgrade marks and status, ▶ Run
 * and Retry failed (the retry path: just those scenes), the activity, and Pause/Resume, Stop and Skip while it runs.
 * With nothing live it shows the video's scenes as saved. A row with pictures opens its options for the one-click swap.
 */
export function PanelQueue(props: Props) {
  const { project, run, client, busy, error, onRunState, onSceneState } = props;
  const stored = useStep();
  const step = props.step !== undefined ? props.step : stored;
  const media = props.media ?? getMediaStore();
  const ids = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [local, setLocal] = useState<null | 'retry-failed' | `run:${string}`>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Swaps shown at once, before the background confirms them (as in the Pictures step).
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [swapping, setSwapping] = useState(false);
  const [focusTo, setFocusTo] = useState<{ pictureId: string; on: 'card' | 'button' } | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const phase = runPhase(project, run);
  const paused = phase === 'paused';
  const live = phase === 'running' || paused;
  const anyLive = isLive(run);
  const saved = useMemo(() => sceneStatesFor(project, run), [project, run]);
  const states = useMemo(() => {
    const out = { ...saved };
    for (const [sceneId, pictureId] of Object.entries(swaps)) if (out[sceneId]) out[sceneId] = { ...out[sceneId], chosenPictureId: pictureId };
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

  // The scene VidFlow is working on now (a paused run isn't working on any).
  const stepScene = phase === 'running' && step && step.projectId === project.id ? step.sceneId : null;
  const currentId = stepScene && (states[stepScene]?.status === 'pending' || states[stepScene]?.status === 'submitted') ? stepScene : null;

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: project.scenes.length, drawing: 0, togo: 0, failed: 0, done: 0 };
    for (const s of project.scenes) c[kindOf(states[s.id]!)]++;
    return c;
  }, [project.scenes, states]);
  const rows = useMemo(
    () => (filter === 'all' ? project.scenes : project.scenes.filter((s) => kindOf(states[s.id]!) === filter)),
    [project.scenes, states, filter],
  );
  const rowsKey = rows.map((s) => s.id).join('|');
  const visible = useSeenRows(listRef, rowsKey);
  const wanted = useMemo(() => {
    const onScreen = visible ? rows.filter((s) => visible.has(s.id)) : rows.slice(0, FIRST_ROWS);
    const out = onScreen.map((s) => chosenPicture(states[s.id])).filter((id): id is string => !!id);
    for (const id of open ? (states[open]?.pictureIds ?? []) : []) if (!out.includes(id)) out.push(id);
    return out;
  }, [rows, visible, states, open]);
  const urls = usePictureUrls(media, wanted);

  // When VidFlow moves on to another scene, bring its row into view (only then: the owner may scroll the list).
  useEffect(() => {
    if (!currentId) return;
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  useEffect(() => {
    if (!focusTo || swapping) return;
    const card = [...(optionsRef.current?.querySelectorAll<HTMLElement>('figure') ?? [])].find((f) => f.dataset.pictureId === focusTo.pictureId);
    const target = focusTo.on === 'card' ? card : card?.querySelector<HTMLElement>('button');
    target?.focus();
    setFocusTo(null);
  }, [focusTo, swapping, states]);

  async function request(kind: NonNullable<typeof local>, send: () => Promise<RunReply>): Promise<boolean> {
    setLocal(kind);
    setLocalError(null);
    try {
      const reply = await send();
      if (!reply.ok) {
        setLocalError(reply.message);
        return false;
      }
      onRunState(reply.state);
      return true;
    } catch {
      setLocalError(REQUEST_FAILED);
      return false;
    } finally {
      setLocal(null);
    }
  }

  const runScene = (sceneId: string) => void request(`run:${sceneId}`, () => client.retry(project.id, sceneId));

  /** Every failed or refused scene, through the same retry path, in order; stops at the first refusal. */
  async function retryFailed() {
    const failed = project.scenes.filter((s) => kindOf(states[s.id]!) === 'failed').map((s) => s.id);
    setLocal('retry-failed');
    setLocalError(null);
    try {
      for (const sceneId of failed) {
        const reply = await client.retry(project.id, sceneId);
        if (!reply.ok) {
          setLocalError(reply.message);
          return;
        }
        onRunState(reply.state);
      }
    } catch {
      setLocalError(REQUEST_FAILED);
    } finally {
      setLocal(null);
    }
  }

  /** One click: the pill moves now; the background (the single writer) saves it; a refusal puts it back and says why. */
  async function swap(sceneId: string, pictureId: string) {
    if (swapping || chosenPicture(states[sceneId]) === pictureId) return;
    setSwapping(true);
    setLocalError(null);
    setSwaps((now) => ({ ...now, [sceneId]: pictureId }));
    try {
      await choosePicture(project.id, sceneId, pictureId, client);
    } catch (e) {
      setSwaps((now) => {
        const next = { ...now };
        delete next[sceneId];
        return next;
      });
      setLocalError(e instanceof Error && e.message ? e.message : SWAP_FAILED);
      setFocusTo({ pictureId, on: 'button' });
      setSwapping(false);
      return;
    }
    setFocusTo({ pictureId, on: 'card' });
    try {
      const fresh = await getProject(project.id);
      const scene = fresh?.sceneStates[sceneId];
      if (scene) onSceneState(sceneId, scene);
      if (live) {
        const reply = await client.get();
        if (reply.ok) onRunState(reply.state);
      }
    } catch {
      // The choice is saved; the next refresh shows it. The swap already shows here.
    } finally {
      setSwapping(false);
    }
  }

  // The line under the name: the step while it runs, else where the video stands.
  const view = live && run ? liveView(run, step, project) : null;
  const total = project.scenes.length;
  const line = paused
    ? 'Paused · press Resume to carry on'
    : live
      ? view?.step
        ? view.scene !== null
          ? `Scene ${view.scene} of ${view.total} · ${view.step}`
          : view.step
        : `Picture ${view?.n ?? 0} of ${view?.total ?? 0}`
      : total === 0
        ? 'No scenes yet. Add them on Setup.'
        : counts.done === total
          ? `All ${total} ${total === 1 ? 'scene has' : 'scenes have'} pictures.`
          : `${counts.done} of ${total} ${total === 1 ? 'scene has' : 'scenes have'} pictures.`;
  const percent = total === 0 ? 0 : Math.round(((counts.done + counts.drawing / 2) / total) * 100);

  // ▶ Run and Retry failed use the retry path: refused while any run is live, so they wait and say why.
  const whyId = `${ids}-why`;
  const skipWhyId = `${ids}-skip-why`;
  const why = !anyLive
    ? null
    : live
      ? '▶ Run and Retry failed work once this run has finished or you stop it.'
      : isHeroSheetRun(run)
        ? '▶ Run and Retry failed work once the model sheet is made.'
        : '▶ Run and Retry failed work once the other video has finished or is stopped.';
  const blocked = anyLive || local !== null || busy !== null;

  // With nothing live, the coral is Start when Setup would allow it (something left to make), else none.
  const remaining = project.scenes.filter((s) => states[s.id]!.status !== 'done' && states[s.id]!.status !== 'refused').length;
  const sheetLive = !!run && isHeroSheetRun(run) && run.projectId === project.id && (run.status === 'running' || run.status === 'paused');
  const canStart = !live && total > 0 && remaining > 0 && !sheetLive;
  const pauseReason = ownerPauseReason(project, run);

  return (
    <>
      <div>
        <b className="vf-pn-name">{project.name}</b>
        <div className="vf-pn-sub">{line}</div>
      </div>
      <div className="vf-pn-track" role="progressbar" aria-label="Pictures made" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="vf-pn-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="vf-pn-note">
        {counts.done} saved · {counts.drawing} being drawn · {counts.togo} to go · {counts.failed} failed
      </div>

      {total > 0 && (
        <div className="vf-pn-filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="vf-pn-filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} {counts[f.id]}
            </button>
          ))}
        </div>
      )}

      {(counts.failed > 0 || why) && (
        <div className="vf-pn-qtools">
          {why && (
            <p className="vf-pn-note" id={whyId}>
              {why}
            </p>
          )}
          {counts.failed > 0 && (
            <Button
              className="vf-pn-sec vf-pn-retry"
              onClick={() => void retryFailed()}
              loading={local === 'retry-failed'}
              disabled={blocked}
              aria-describedby={why ? whyId : undefined}
            >
              Retry failed
            </Button>
          )}
        </div>
      )}

      {total > 0 && (
        <ul ref={listRef} className="vf-pn-queue" aria-label="Scenes">
          {rows.map((scene) => {
            const s = states[scene.id]!;
            const n = sceneNumber(project, scene.id) ?? 0;
            const nn = pad(n);
            const current = scene.id === currentId;
            const marks = sceneMarks(s, project);
            const thumb = chosenPicture(s);
            const url = thumb ? urls[thumb] : undefined;
            const hasPictures = s.pictureIds.length > 0;
            const expanded = open === scene.id && hasPictures;
            const detail: string[] = [];
            const tc = timecode(scene);
            if (tc) detail.push(tc);
            if (current && step) detail.push(lowerFirst(step.text));
            else if (s.status === 'submitted') detail.push('sent to Flow');
            else if (s.status === 'failed' || s.status === 'refused') detail.push(s.message ?? 'No reason was given.');
            if (s.status === 'done') {
              if (marks.checked) detail.push('✓ checked');
              if (marks.hero) detail.push('hero ✓');
              if (marks.options > 1) detail.push(`${marks.options} options`);
            }
            const tag =
              s.status === 'done'
                ? { text: '✓ Saved', tone: 'done' }
                : current && step?.target === 'tile'
                  ? { text: 'Checking', tone: 'current' }
                  : s.status === 'submitted'
                    ? { text: 'Drawing', tone: current ? 'current' : undefined }
                    : s.status === 'failed'
                      ? { text: 'Failed', tone: 'warn' }
                      : s.status === 'refused'
                        ? { text: 'Refused', tone: 'warn' }
                        : null;
            const canRun = !current && (s.status === 'pending' || s.status === 'failed' || s.status === 'refused');
            const optionsId = `${ids}-options-${scene.id}`;
            const body = (
              <>
                <span className="vf-pn-qimg" data-empty={url ? undefined : ''}>
                  {url && <img src={url} alt="" />}
                </span>
                <span className="vf-pn-qt">
                  {nn} · {scene.sentence ? `"${scene.sentence}"` : 'No sentence'}
                  {detail.length > 0 && <small>{detail.join(' · ')}</small>}
                </span>
              </>
            );
            return (
              <li key={scene.id} className="vf-pn-qrow" data-scene={scene.id} data-current={current || undefined} aria-current={current ? 'step' : undefined}>
                <div className="vf-pn-qline">
                  {hasPictures ? (
                    <button
                      type="button"
                      className="vf-pn-qopen"
                      aria-expanded={expanded}
                      aria-controls={expanded ? optionsId : undefined}
                      onClick={() => setOpen(expanded ? null : scene.id)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="vf-pn-qopen">{body}</div>
                  )}
                  {(tag || canRun) && (
                    <div className="vf-pn-qside">
                      {tag && (
                        <span className="vf-pn-tag" data-tone={tag.tone}>
                          {tag.text}
                        </span>
                      )}
                      {canRun && (
                        <button
                          type="button"
                          className="vf-pn-run"
                          aria-label={`Run scene ${n}`}
                          aria-describedby={why ? whyId : undefined}
                          aria-busy={local === `run:${scene.id}` || undefined}
                          disabled={blocked}
                          onClick={() => runScene(scene.id)}
                        >
                          ▶ Run
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {expanded && (
                  <section id={optionsId} className="vf-pn-qoptions" aria-label={`Scene ${nn} options`}>
                    <Options
                      ref={optionsRef}
                      project={project}
                      state={s}
                      urls={urls}
                      busy={swapping}
                      onUse={(pictureId) => void swap(scene.id, pictureId)}
                    />
                  </section>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="vf-pn-activity">
        <ActivityList projectId={project.id} project={project} limit={5} showSwitch={false} />
      </div>

      {pauseReason && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {pauseReason}
        </p>
      )}
      {(localError ?? error) && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {localError ?? error}
        </p>
      )}

      {paused && (
        // Paused, nothing is being worked on: there is no current scene to skip.
        <p className="vf-pn-note vf-pn-end" id={skipWhyId}>
          Skip works while VidFlow is making pictures.
        </p>
      )}
      {live ? (
        <div className={paused ? 'vf-pn-actions' : 'vf-pn-actions vf-pn-end'}>
          {paused ? (
            <Button variant="primary" onClick={props.onResume} loading={busy === 'resume'} disabled={busy === 'stop'}>
              Resume
            </Button>
          ) : (
            <Button variant="primary" onClick={props.onPause} loading={busy === 'pause'} disabled={busy === 'stop'}>
              Pause
            </Button>
          )}
          <Button onClick={props.onStop} loading={busy === 'stop'} disabled={busy !== null && busy !== 'stop'}>
            Stop
          </Button>
          <Button
            onClick={props.onSkip}
            loading={busy === 'skip'}
            disabled={paused || (busy !== null && busy !== 'skip')}
            aria-describedby={paused ? skipWhyId : undefined}
          >
            Skip
          </Button>
        </div>
      ) : (
        canStart && (
          <div className="vf-pn-actions vf-pn-end">
            <Button variant="primary" onClick={props.onStart} loading={busy === 'start'} disabled={local !== null}>
              Start making pictures
            </Button>
          </div>
        )
      )}
    </>
  );
}

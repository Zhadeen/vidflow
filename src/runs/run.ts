import { clipPrompt } from '../motion/clips';
import { clipLengthFor, slideSeconds, type ClipLength, type ClipRecord } from '../motion/timing';
import { chosenPicture } from '../studio/chosen';
import type { AspectRatio, Project, SceneState } from '../store/projects';

export type RunEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restore' } // after a real browser restart: pages are gone, so submitted scenes go back in the queue
  | { type: 'submitted'; sceneId: string; prompt?: string; at?: number }
  /** `withHero`: the run had the hero reference attached in Flow when these were made. */
  | { type: 'pictures'; sceneId: string; mediaIds: string[]; cardKeys?: string[]; withHero?: boolean }
  /**
   * Generate is about to be pressed (recorded first, so a worker suspended mid-press looks before pressing again), or
   * was pressed but Flow's start wasn't seen. The scene stays pending until `submitted`; `at` starts its wait limit.
   */
  | { type: 'unconfirmed'; sceneId: string; keysBefore: string[]; prompt: string; at?: number; credits?: number; othersBefore?: number }
  /** The full prompt read from a Flow card's detail view. */
  | { type: 'detail'; cardKey: string; prompt: string }
  | { type: 'refused'; sceneId: string; message: string }
  | { type: 'failed'; sceneId: string; message: string }
  /** The owner stopped the run: nothing more is sent; scenes in Flow go back to waiting; pictures stay. */
  | { type: 'stop' }
  /** The owner pressed Try again on a refused or failed scene: it goes back in the queue. */
  | { type: 'retry'; sceneId: string }
  /**
   * The owner skipped this scene (spec §19): it ends as failed "Skipped by you" and the run moves on. If it was in Flow
   * its submission is kept in skippedPrompts, so its pictures still take their place in the order but are never saved.
   */
  | { type: 'skip'; sceneId: string }
  /** The owner chose which of a scene's pictures it uses (ignored unless it is one of them). */
  | { type: 'choose'; sceneId: string; pictureId: string }
  /** A clip run saved a slide's clip (from the result tile `cardKey`). */
  | { type: 'clip'; sceneId: string; clip: ClipRecord; cardKey: string }
  /** A clip run's finished tile (poster key) belongs to this slide: never matched to another (lasting, saved). */
  | { type: 'clipClaim'; key: string; sceneId: string }
  /** A clip run matched this finished tile to the slide and is checking it (its deadline waits). */
  | { type: 'clipMatched'; sceneId: string; key: string }
  /** A clip press Flow answered with its usage notice: its credits are counted already, not again for the next press. */
  | { type: 'paid'; sceneId: string; credits: number }
  /** A clip run pressed Generate for a clip costing this many credits (counted whatever Flow does with it). */
  | { type: 'spent'; credits: number }
  /** A clip run read Flow's credit balance (once, before its first clip). */
  | { type: 'balance'; credits: number }
  /** A clip run reached its credit limit or the balance: slides still waiting aren't made (spec §20 settled 7). */
  /** sceneId: the slide being set up when it ran out (its earlier press, if any, was found not to have started). */
  | { type: 'outOfCredits'; message: string; sceneId?: string }
  | { type: 'limit'; message: string; resumeAt: number | null }
  | {
      type: 'needsOwner';
      reason: 'policy-dialog' | 'signed-out' | 'wrong-account' | 'page-not-recognised';
      message: string;
      /** The slide this pause is about (the owner may Skip it while paused). */
      sceneId?: string;
    };

export const USER_PAUSE_REASON = 'Paused by you';

/** A skipped scene's message (spec §19). */
export const SKIPPED_MESSAGE = 'Skipped by you';

/** A submission the owner skipped: Flow may still draw it; its tiles fill its place in the order and are never saved. */
export interface SkippedSubmission {
  sceneId: string;
  prompt: string;
  seq: number;
  at: number;
}

const isSkipped = (s: SceneState | undefined) => s?.status === 'failed' && s.message === SKIPPED_MESSAGE;

/** Said when a picture choice names a picture the scene doesn't have (or a scene the project doesn't have). */
export const NOT_THIS_SCENES_PICTURE =
  "That picture isn't one of this scene's pictures any more. Pick one of the pictures shown.";

/** The model sheet's pseudo-scene: the only "scene" of a hero-sheet run, never one of the project's scenes. */
export const HERO_SHEET_ID = 'hero-sheet';

/** Said on a slide's row when a clip run stopped before making its clip. */
export const CREDIT_LIMIT_NOTE = 'Not made — credit limit';
export const BALANCE_NOTE = 'Not made — not enough Flow credits';

/** One slide of a clip run, fixed when the run starts: the picture, lengths and prompt it is made with. */
export interface ClipJob {
  pictureId: string;
  /** How long the slide is on screen (its timecode). */
  seconds: number;
  /** The Flow clip length asked for. */
  length: ClipLength;
  prompt: string;
}

export interface RunState {
  projectId: string;
  /**
   * 'hero-sheet': this run makes the hero's model sheet (one prompt, pseudo-scene HERO_SHEET_ID), saved on
   * project.heroSheet rather than the scenes. 'clips': a Motion run (spec §20): one clip per slide from its chosen
   * picture; its scene states are the clips' progress, never the pictures'. Absent for a scene (pictures) run.
   */
  kind?: 'hero-sheet' | 'clips';
  /** A clip run's slides, fixed when it starts. */
  clips?: Record<string, ClipJob>;
  /** A clip run's credit limit, what it has pressed Generate for so far, and Flow's balance read before its first clip. */
  limit?: number;
  spent?: number;
  balance?: number;
  /** A clip run's finished tiles (poster keys) and Flow clips (media ids) that belong to a slide: never matched again. */
  clipClaims?: Record<string, string>;
  flowMediaIds?: Record<string, string>;
  /**
   * A hero-sheet run's outputs and shape, fixed when it starts: Flow was asked for these, so matching counts them,
   * whatever the project's settings say later.
   */
  sheet?: { outputs: Project['outputsPerPrompt']; aspect: AspectRatio };
  status: 'idle' | 'running' | 'paused' | 'finished';
  pauseReason?: string;
  resumeAt?: number | null;
  /** The slide a pause is about (a clip VidFlow couldn't tell Flow started): Skip while paused skips it, and only it. */
  pauseSceneId?: string;
  inFlight: string[];
  sceneStates: Record<string, SceneState>;
  /** The fresh Flow project this run works in (spec §16.5). Unset until the run creates it; a new run starts without. */
  flowProjectUrl?: string;
  /** Submission counter for result matching (Flow lists tiles in submission order). */
  nextSeq?: number;
  /** Full prompts read from Flow cards' detail views, by card key (verification before saving). */
  detailPrompts?: Record<string, string>;
  /**
   * The hero reference uploaded into this run's Flow project (spike S7), by its asset name. The upload is a tile in
   * Flow's grid too: its card keys (and any tile captioned with its name) are never matched to a scene.
   */
  reference?: { name: string; flowProjectUrl: string; cardKeys: string[] };
  /** Submissions the owner skipped while they were in Flow, in order (never matched to a scene). */
  skippedPrompts?: SkippedSubmission[];
}

/** Every scene without a done/refused state starts (again) as pending. */
export function initRun(project: Project): RunState {
  const sceneStates: Record<string, SceneState> = {};
  for (const scene of project.scenes) {
    const existing = project.sceneStates[scene.id];
    sceneStates[scene.id] =
      existing && (existing.status === 'done' || existing.status === 'refused')
        ? { ...existing }
        : { sceneId: scene.id, status: 'pending', pictureIds: existing?.pictureIds ?? [] };
  }
  return { projectId: project.id, status: 'idle', inFlight: [], sceneStates };
}

/** A run that makes only the hero's model sheet, starting from scratch (a fresh Flow project, no pictures yet). */
export function initHeroSheetRun(project: Project): RunState {
  return {
    projectId: project.id,
    kind: 'hero-sheet',
    sheet: { outputs: project.outputsPerPrompt, aspect: project.aspect },
    status: 'idle',
    inFlight: [],
    sceneStates: { [HERO_SHEET_ID]: { sceneId: HERO_SHEET_ID, status: 'pending', pictureIds: [] } },
  };
}

/**
 * A Motion run for these slides (scene ids, in project order): each makes a clip from the slide's chosen picture at
 * the shortest Flow length covering it, within `limit` credits. The pictures themselves are never touched.
 */
export function initClipRun(project: Project, sceneIds: string[], limit: number): RunState {
  const sceneStates: Record<string, SceneState> = {};
  const clips: Record<string, ClipJob> = {};
  for (const id of sceneIds) {
    const scene = project.scenes.find((s) => s.id === id);
    const saved = project.sceneStates[id];
    const pictureId = chosenPicture(saved);
    if (!scene || !pictureId) continue;
    const seconds = slideSeconds(scene);
    clips[id] = { pictureId, seconds, length: clipLengthFor(seconds), prompt: clipPrompt(scene) };
    sceneStates[id] = { sceneId: id, status: 'pending', pictureIds: saved?.pictureIds ?? [] };
  }
  return { projectId: project.id, kind: 'clips', clips, limit, spent: 0, status: 'idle', inFlight: [], sceneStates };
}

export const isHeroSheetRun = (run: Pick<RunState, 'kind'> | null | undefined): boolean => run?.kind === 'hero-sheet';
export const isClipRun = (run: Pick<RunState, 'kind'> | null | undefined): boolean => run?.kind === 'clips';
/** A run that makes the project's scene pictures (not the model sheet, not clips). */
export const isSceneRun = (run: Pick<RunState, 'kind'> | null | undefined): boolean => !!run && run.kind === undefined;

/** Running, or paused with something still to make: no other run may start. */
export function isLive(run: RunState | null | undefined): boolean {
  if (!run) return false;
  return run.status === 'running' || (run.status === 'paused' && hasUnfinished(run));
}

function hasUnfinished(state: RunState): boolean {
  return Object.values(state.sceneStates).some((s) => s.status === 'pending' || s.status === 'submitted');
}

function settle(state: RunState): RunState {
  return state.status === 'running' && !hasUnfinished(state) ? { ...state, status: 'finished' } : state;
}

function setScene(state: RunState, sceneId: string, patch: Partial<SceneState>): RunState {
  const current = state.sceneStates[sceneId];
  if (!current) return state;
  return {
    ...state,
    inFlight: state.inFlight.filter((id) => id !== sceneId),
    sceneStates: { ...state.sceneStates, [sceneId]: { ...current, ...patch } },
  };
}

/**
 * Anything still submitted is stale (the page it was on is gone): put it back in the queue. A clip run's clip was paid
 * for when it was pressed: after a restart it goes back as unconfirmed, so its tile is looked for before any new press.
 */
function requeueSubmitted(state: RunState, keepPressed = false): RunState {
  const sceneStates: Record<string, SceneState> = {};
  for (const [id, s] of Object.entries(state.sceneStates)) {
    if (s.status !== 'submitted') sceneStates[id] = s;
    else {
      const { submission, ...rest } = s;
      const unconfirmed =
        keepPressed && submission
          ? {
              unconfirmed: {
                keysBefore: submission.keysBefore ?? [],
                prompt: submission.prompt,
                at: Date.now(),
                seq: submission.seq,
                // It was in Flow ('submitted'): Flow confirmed the press started. It is never pressed again on its own.
                confirmed: true as const,
                ...(submission.othersBefore !== undefined ? { othersBefore: submission.othersBefore } : {}),
              },
            }
          : {};
      sceneStates[id] = { ...rest, status: 'pending', ...unconfirmed };
    }
  }
  return { ...state, inFlight: [], sceneStates };
}

/**
 * The unconfirmed wait limit counts running time only: on start/resume each pending scene's unconfirmed clock starts
 * again (as its deadline alarms are re-armed), so a long pause can't fail it at the first look afterwards.
 */
function restartUnconfirmedClocks(state: RunState): RunState {
  const now = Date.now();
  let sceneStates = state.sceneStates;
  for (const [id, s] of Object.entries(state.sceneStates)) {
    if (s.status !== 'pending' || !s.unconfirmed) continue;
    sceneStates = { ...sceneStates, [id]: { ...s, unconfirmed: { ...s.unconfirmed, at: now } } };
  }
  return sceneStates === state.sceneStates ? state : { ...state, sceneStates };
}

function clearPause(state: RunState): RunState {
  const { pauseReason: _r, resumeAt: _t, pauseSceneId: _s, ...rest } = state;
  return rest;
}

export function reduceRun(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'start':
      return settle({ ...clearPause(restartUnconfirmedClocks(requeueSubmitted(state))), status: 'running' });
    case 'resume':
      if (state.status === 'running') return state;
      return settle({ ...clearPause(restartUnconfirmedClocks(state)), status: 'running' });
    case 'restore':
      return requeueSubmitted(state, state.kind === 'clips');
    case 'pause':
      if (state.status !== 'running' && state.status !== 'paused') return state; // nothing to pause
      return { ...clearPause(state), status: 'paused', pauseReason: USER_PAUSE_REASON, resumeAt: null };
    case 'submitted': {
      const current = state.sceneStates[event.sceneId];
      if (isSkipped(current)) {
        // Flow confirmed a press after the owner skipped the scene: its pictures will come, so it takes its place.
        const seq = (state.nextSeq ?? 0) + 1;
        const skipped = { sceneId: event.sceneId, prompt: event.prompt ?? '', seq, at: event.at ?? Date.now() };
        return { ...state, nextSeq: seq, skippedPrompts: [...(state.skippedPrompts ?? []), skipped] };
      }
      if (!current || current.status !== 'pending') return state;
      // A clip found again after a restart keeps its place in the order (its first submission's seq).
      const seq = current.unconfirmed?.seq ?? (state.nextSeq ?? 0) + 1;
      const { unconfirmed: seen, ...rest } = current;
      const submission = {
        seq,
        at: event.at ?? Date.now(),
        prompt: event.prompt ?? '',
        ...(state.kind === 'clips' && seen
          ? { keysBefore: seen.keysBefore, ...(seen.othersBefore !== undefined ? { othersBefore: seen.othersBefore } : {}) }
          : {}),
      };
      return {
        ...state,
        nextSeq: Math.max(seq, state.nextSeq ?? 0),
        inFlight: [...state.inFlight.filter((id) => id !== event.sceneId), event.sceneId],
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...rest, status: 'submitted', submission } },
      };
    }
    case 'unconfirmed': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status !== 'pending') return state;
      // What an earlier press Flow answered with its usage notice counted stays counted (it's never paid twice).
      const paid = current.unconfirmed?.paid;
      const confirmed = current.unconfirmed?.confirmed;
      const unconfirmed = {
        keysBefore: event.keysBefore,
        prompt: event.prompt,
        at: event.at ?? Date.now(),
        ...(event.othersBefore !== undefined ? { othersBefore: event.othersBefore } : {}),
        ...(paid !== undefined ? { paid } : {}),
        ...(confirmed ? { confirmed } : {}),
      };
      return {
        ...state,
        // A clip's credits are counted with the record of its press, in one step (rolled back if it isn't pressed).
        ...(event.credits ? { spent: (state.spent ?? 0) + event.credits } : {}),
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, unconfirmed } },
      };
    }
    case 'detail':
      return { ...state, detailPrompts: { ...state.detailPrompts, [event.cardKey]: event.prompt } };
    case 'pictures':
      if (!state.inFlight.includes(event.sceneId)) return state; // stale
      return settle(
        setScene(state, event.sceneId, {
          status: 'done',
          pictureIds: event.mediaIds,
          chosenPictureId: undefined, // new pictures: the best-picture choice is made again (Plan 2)
          choiceSource: undefined,
          autoReason: undefined,
          autoChecked: undefined,
          message: undefined,
          withHero: event.withHero === true,
          ...(event.cardKeys ? { cardKeys: event.cardKeys } : {}),
        }),
      );
    case 'refused':
    case 'failed': {
      const current = state.sceneStates[event.sceneId];
      if (!current || current.status === 'done' || isSkipped(current)) return state;
      return settle(
        setScene(state, event.sceneId, { status: event.type === 'refused' ? 'refused' : 'failed', message: event.message }),
      );
    }
    case 'skip': {
      const current = state.sceneStates[event.sceneId];
      if (!current || (current.status !== 'pending' && current.status !== 'submitted')) return state;
      // Paused about one slide: Skip means that slide, never another.
      const aboutIt = state.status === 'paused' && state.pauseSceneId !== undefined;
      if (aboutIt && event.sceneId !== state.pauseSceneId) return state;
      const { submission, unconfirmed: pressed, ...rest } = current;
      // A clip slide Flow confirmed started (then a restart) has its clip in Flow, as a submitted one does: it keeps its
      // place in the order, so it is never matched to a later slide.
      const pressedSeq = pressed?.confirmed && state.kind === 'clips' ? (pressed.seq ?? (state.nextSeq ?? 0) + 1) : undefined;
      const skipped =
        current.status === 'submitted' && submission
          ? [...(state.skippedPrompts ?? []), { sceneId: event.sceneId, prompt: submission.prompt, seq: submission.seq, at: submission.at }]
          : pressed && pressedSeq !== undefined
            ? [...(state.skippedPrompts ?? []), { sceneId: event.sceneId, prompt: pressed.prompt, seq: pressedSeq, at: Date.now() }]
            : state.skippedPrompts;
      // The pause was about this slide: it now waits for Resume like any pause by the owner.
      const base = aboutIt ? { ...clearPause(state), pauseReason: USER_PAUSE_REASON, resumeAt: null } : state;
      return settle({
        ...base,
        ...(pressedSeq !== undefined ? { nextSeq: Math.max(pressedSeq, state.nextSeq ?? 0) } : {}),
        ...(skipped ? { skippedPrompts: skipped } : {}),
        inFlight: state.inFlight.filter((id) => id !== event.sceneId),
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...rest, status: 'failed', message: SKIPPED_MESSAGE } },
      });
    }
    case 'stop':
      return { ...clearPause(requeueSubmitted(state)), status: 'idle' };
    case 'retry': {
      const current = state.sceneStates[event.sceneId];
      if (!current || (current.status !== 'refused' && current.status !== 'failed')) return state;
      const { message: _m, submission: _s, unconfirmed: _u, ...rest } = current;
      return {
        ...state,
        // A finished run carries on with the re-queued scene; a paused one waits for Resume.
        status: state.status === 'finished' ? 'running' : state.status,
        sceneStates: { ...state.sceneStates, [event.sceneId]: { ...rest, status: 'pending' } },
      };
    }
    case 'choose': {
      const current = state.sceneStates[event.sceneId];
      if (!current || !current.pictureIds.includes(event.pictureId)) return state;
      return { ...state, sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, chosenPictureId: event.pictureId, choiceSource: 'owner' } } };
    }
    case 'clip': {
      if (!state.inFlight.includes(event.sceneId)) return state; // stale (skipped or stopped meanwhile)
      const claimed = {
        ...state,
        clipClaims: { ...state.clipClaims, [event.cardKey]: event.sceneId },
        ...(event.clip.flowMediaId ? { flowMediaIds: { ...state.flowMediaIds, [event.clip.flowMediaId]: event.sceneId } } : {}),
      };
      return settle(setScene(claimed, event.sceneId, { status: 'done', clip: event.clip, message: undefined, cardKeys: [event.cardKey] }));
    }
    case 'clipClaim':
      return { ...state, clipClaims: { ...state.clipClaims, [event.key]: event.sceneId } };
    case 'clipMatched': {
      const current = state.sceneStates[event.sceneId];
      if (current?.status !== 'submitted' || !current.submission) return state;
      const submission = { ...current.submission, clipKey: event.key };
      return { ...state, sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, submission } } };
    }
    case 'paid': {
      const current = state.sceneStates[event.sceneId];
      if (!current?.unconfirmed) return state;
      const unconfirmed = { ...current.unconfirmed, paid: event.credits };
      return { ...state, sceneStates: { ...state.sceneStates, [event.sceneId]: { ...current, unconfirmed } } };
    }
    case 'spent':
      return { ...state, spent: (state.spent ?? 0) + event.credits };
    case 'balance':
      return { ...state, balance: event.credits };
    case 'outOfCredits': {
      let sceneStates = state.sceneStates;
      for (const [id, s] of Object.entries(state.sceneStates)) {
        // A slide whose press may have reached Flow (unconfirmed) is still looked for, never "not made".
        if (s.status !== 'pending' || (s.unconfirmed && id !== event.sceneId)) continue;
        const { unconfirmed: _u, ...rest } = s;
        sceneStates = { ...sceneStates, [id]: { ...rest, status: 'failed', message: event.message } };
      }
      return settle({ ...state, sceneStates });
    }
    case 'limit':
      return { ...clearPause(state), status: 'paused', pauseReason: event.message, resumeAt: event.resumeAt };
    case 'needsOwner':
      return {
        ...clearPause(state),
        status: 'paused',
        pauseReason: event.message,
        resumeAt: null,
        ...(event.sceneId ? { pauseSceneId: event.sceneId } : {}),
      };
  }
}

export function nextSceneToSubmit(state: RunState, order: string[], maxInFlight: number): string | null {
  if (state.status !== 'running' || state.inFlight.length >= maxInFlight) return null;
  for (const id of order) {
    if (state.sceneStates[id]?.status === 'pending' && !state.inFlight.includes(id)) return id;
  }
  return null;
}

export function runSummary(state: RunState): { done: number; refused: string[]; failed: string[]; pending: number } {
  const all = Object.values(state.sceneStates);
  return {
    done: all.filter((s) => s.status === 'done').length,
    refused: all.filter((s) => s.status === 'refused').map((s) => s.sceneId),
    failed: all.filter((s) => s.status === 'failed').map((s) => s.sceneId),
    pending: all.filter((s) => s.status === 'pending' || s.status === 'submitted').length,
  };
}

/** The next 00:00 local time strictly after `now`. */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Fill in what Flow could not tell us: a missing reset time becomes local midnight, and the message says when we carry on. */
export function normaliseEvent(event: RunEvent, now: number): RunEvent {
  if (event.type !== 'limit') return event;
  const resumeAt = event.resumeAt ?? nextLocalMidnight(now);
  return { type: 'limit', resumeAt, message: `Flow's daily limit was reached. VidFlow will carry on at ${clock(resumeAt)}.` };
}

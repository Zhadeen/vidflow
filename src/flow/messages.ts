import type { StepTarget } from '../runs/activity';
import type { RunEvent, RunState } from '../runs/run';
import type { AspectRatio } from '../store/projects';
import type { FlowResultCard, StartVerb } from './driver';
import type { PillView } from './pill';

/** Messages between the background and the Flow helper (content script). */
export const FLOW_PREPARE = 'flow/prepare';
export const FLOW_NEW_PROJECT = 'flow/new-project';
export const FLOW_CONFIRM = 'flow/confirm';
export const FLOW_EVENT = 'flow/event';
export const FLOW_TILES = 'flow/tiles';
export const FLOW_TILES_NOW = 'flow/tiles-now';
export const FLOW_TILE_POINT = 'flow/tile-point';
export const FLOW_DETAIL = 'flow/detail';
export const FLOW_PILL = 'flow/pill';
export const FLOW_PILL_TOGGLE = 'flow/pill-toggle';
export const FLOW_UPLOAD_REFERENCE = 'flow/upload-reference';

/** Said whenever VidFlow can't upload or attach the hero reference: a prompt that names it is never sent without it. */
export const REFERENCE_ATTACH_MESSAGE =
  "VidFlow couldn't attach the hero reference in Flow. Check the Flow window, then press Resume.";

/** Said when a picture is left in Flow's prompt bar for a prompt that doesn't use one, and VidFlow can't take it out. */
export const STRAY_INGREDIENT_MESSAGE =
  "Flow's prompt bar has a picture in it that VidFlow couldn't take out. Remove it in the Flow window, then press Resume.";

export interface Point {
  x: number;
  y: number;
}

export interface SubmitOptions {
  aspect?: AspectRatio;
  outputs?: 1 | 2 | 4;
  /** The button named in owner-facing messages. */
  verb?: StartVerb;
  /**
   * The hero reference already uploaded to this Flow project, by its asset name: attached before typing, and the
   * prompt is only answered ready while its Ingredient chip shows. Absent for prompts that don't use a reference.
   */
  reference?: { name: string };
}

/** background → Flow tab: set up and type the prompt; answer with where Generate is. */
export interface PrepareRequest extends SubmitOptions {
  type: typeof FLOW_PREPARE;
  prompt: string;
}

/** background → Flow tab (home page): check the account, then answer with where "New project" is. */
export interface NewProjectRequest {
  type: typeof FLOW_NEW_PROJECT;
  verb: StartVerb;
}

/** background → Flow tab, right after pressing Generate: did Flow start a picture? */
export interface ConfirmRequest {
  type: typeof FLOW_CONFIRM;
}
export interface ConfirmResponse {
  started: boolean;
}

/** background → Flow tab: the result tiles in the DOM right now. */
export interface TilesNowRequest {
  type: typeof FLOW_TILES_NOW;
}
export interface TilesNowResponse {
  cards: FlowResultCard[];
}

/** background → Flow tab: scroll the finished tile with this media id into view; answer with its centre (to open it). */
export interface TilePointRequest {
  type: typeof FLOW_TILE_POINT;
  key: string;
}

/** background → Flow tab, on a picture's detail page: the full original prompt shown there. */
export interface DetailRequest {
  type: typeof FLOW_DETAIL;
}
export interface DetailResponse {
  prompt: string | null;
  mediaId: string | null;
}

/**
 * background → VidFlow's own Flow tab, once per run in its fresh Flow project: upload the hero reference through the
 * ingredients picker. The picture lives in the extension's media store, which the page can't read, so its bytes travel
 * as base64 (a 10 MB picture is ~13.4 MB, well inside runtime messaging's 64 MB limit).
 */
export interface UploadReferenceRequest {
  type: typeof FLOW_UPLOAD_REFERENCE;
  name: string;
  mimeType: string;
  data: string;
}
/** mediaId: the uploaded picture's own grid tile (never a scene's picture), or null when it didn't show in time. */
export type UploadReferenceResponse =
  | { kind: 'done'; mediaId: string | null }
  | { kind: 'blocked'; event: BlockingEvent }
  | { kind: 'error'; message: string };

const CHUNK = 0x8000;

/** Bytes → base64, a chunk at a time (spreading 10 MB into one String.fromCharCode call overflows the stack). */
export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function decodeBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type ToFlowTab =
  | PrepareRequest
  | NewProjectRequest
  | ConfirmRequest
  | TilesNowRequest
  | TilePointRequest
  | DetailRequest
  | UploadReferenceRequest;

export type BlockingEvent = Extract<RunEvent, { type: 'needsOwner' } | { type: 'limit' }>;

/** Answer to PrepareRequest, NewProjectRequest and TilePointRequest. */
export type PrepareResponse =
  | { kind: 'ready'; x: number; y: number }
  | { kind: 'blocked'; event: BlockingEvent }
  | { kind: 'error'; message: string };

/**
 * The only events a Flow tab may send (FLOW_EVENT): page-level blocks. Scene outcomes come from the coordinator's own
 * matching, never from the page. Returns the event, or null for anything else.
 */
export function flowTabEvent(event: unknown): BlockingEvent | null {
  const type = (event as { type?: unknown } | null)?.type;
  return type === 'limit' || type === 'needsOwner' ? (event as BlockingEvent) : null;
}

/** Flow tab → background: something the run must react to (only limit / needsOwner are accepted). */
export interface FlowEventMessage {
  type: typeof FLOW_EVENT;
  event: RunEvent;
}

/** Flow tab → background: the result tiles currently in the DOM (raw; the coordinator matches them to scenes). */
export interface FlowTilesMessage {
  type: typeof FLOW_TILES;
  cards: FlowResultCard[];
}

/** Flow tab → background: what the pill should show for this tab (null = hidden). */
export interface PillRequest {
  type: typeof FLOW_PILL;
}
/** What VidFlow is touching on the page now (the ring), and the scene it is for. */
export interface LiveHighlight {
  target: Exclude<StepTarget, null>;
  key?: string;
  scene: number | null;
}
/** The pill, plus the ring target and the saved pictures (card key → scene number) for the live activity overlays. */
export type LiveView = PillView & { highlight: LiveHighlight | null; savedCards: Array<[string, number]> };
export type PillResponse = LiveView | null;

/** Flow tab → background: the pill's Pause/Resume button. */
export interface PillToggle {
  type: typeof FLOW_PILL_TOGGLE;
  action: 'pause' | 'resume';
}

export type ToBackground = FlowEventMessage | FlowTilesMessage | PillRequest | PillToggle;

/** The Flow page needs the owner (or a wait) before VidFlow can submit; the run pauses instead of failing the scene. */
export class FlowBlockedError extends Error {
  constructor(readonly event: BlockingEvent) {
    super(event.message);
    this.name = 'FlowBlockedError';
  }
}

// ---- Studio ↔ background -----------------------------------------------------

export const RUN_GET = 'run/get';
export const RUN_START = 'run/start';
export const RUN_PAUSE = 'run/pause';
export const RUN_RESUME = 'run/resume';
export const RUN_RETRY = 'run/retry';
export const RUN_STOP = 'run/stop';
/** The project's scenes were replaced: the background forgets a finished run for it. */
export const RUN_FORGET = 'run/forget';
/** The owner chose one of a scene's pictures; taken by a live run and the stored project alike. */
export const RUN_CHOOSE = 'run/choose';
/** Make the hero's model sheet in Flow (its own one-prompt run); Try again on a refused sheet sends this too. */
export const RUN_HERO_SHEET = 'run/hero-sheet';
export const RUN_STATE = 'run/state';

/** studio → background. Each is answered with a RunReply. */
export type StudioRequest =
  | { type: typeof RUN_GET }
  | { type: typeof RUN_START; projectId: string }
  | { type: typeof RUN_PAUSE }
  | { type: typeof RUN_RESUME }
  | { type: typeof RUN_STOP }
  | { type: typeof RUN_FORGET; projectId: string }
  | { type: typeof RUN_RETRY; projectId: string; sceneId: string }
  | { type: typeof RUN_CHOOSE; projectId: string; sceneId: string; pictureId: string }
  | { type: typeof RUN_HERO_SHEET; projectId: string };

/** The run as it is now, or why the request was refused (message is shown to the owner word for word). */
export type RunReply =
  | { ok: true; state: RunState | null }
  | {
      ok: false;
      reason?: 'wrong-account' | 'signed-out' | 'policy-dialog' | 'page-not-recognised' | 'busy' | 'error';
      message: string;
    };

/** background → studio, on every change of the run. */
export interface RunStateMessage {
  type: typeof RUN_STATE;
  state: RunState;
}

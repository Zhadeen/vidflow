import type { RunEvent, RunState } from '../runs/run';
import type { AspectRatio } from '../store/projects';
import type { FlowResultCard, StartVerb } from './driver';

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

export interface Point {
  x: number;
  y: number;
}

export interface SubmitOptions {
  aspect?: AspectRatio;
  outputs?: 1 | 2 | 4;
  /** The button named in owner-facing messages. */
  verb?: StartVerb;
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

export type ToFlowTab = PrepareRequest | NewProjectRequest | ConfirmRequest | TilesNowRequest | TilePointRequest | DetailRequest;

export type BlockingEvent = Extract<RunEvent, { type: 'needsOwner' } | { type: 'limit' }>;

/** Answer to PrepareRequest, NewProjectRequest and TilePointRequest. */
export type PrepareResponse =
  | { kind: 'ready'; x: number; y: number }
  | { kind: 'blocked'; event: BlockingEvent }
  | { kind: 'error'; message: string };

/** Flow tab → background: something the run must react to. */
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
export type PillResponse = { n: number; total: number; paused: boolean } | null;

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
export const RUN_STATE = 'run/state';

/** studio → background. Each is answered with a RunReply. */
export type StudioRequest =
  | { type: typeof RUN_GET }
  | { type: typeof RUN_START; projectId: string }
  | { type: typeof RUN_PAUSE }
  | { type: typeof RUN_RESUME }
  | { type: typeof RUN_RETRY; projectId: string; sceneId: string };

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

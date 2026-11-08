/// <reference types="chrome" />
import type { FlowPort } from '../runs/coordinator';
import type { ClipFile, CreditBalance, FlowResultCard, StartVerb, VideoDetailRead } from './driver';
import {
  FlowBlockedError,
  FLOW_ACCEPT_NOTICE,
  FLOW_AGENT_FINISH,
  FLOW_AGENT_READY,
  FLOW_AGENT_PREPARE,
  FLOW_AGENT_REPLY,
  FLOW_CLIP_FILE,
  FLOW_CREDIT_BALANCE,
  FLOW_GENERATE_COST,
  FLOW_PREPARE_CLIP,
  FLOW_UPLOAD_START_FRAME,
  FLOW_VIDEO_DETAIL,
  FLOW_VIDEO_TILES_NOW,
  type AgentFinishResponse,
  type AgentReadyResponse,
  type AgentReplyResponse,
  type ClipFileResponse,
  type ClipOptions,
  type CreditBalanceResponse,
  type GenerateCostResponse,
  type UploadStartFrameResponse,
  type VideoDetailResponse,
  FLOW_CONFIRM,
  FLOW_DETAIL,
  FLOW_NEW_PROJECT,
  FLOW_PREPARE,
  FLOW_TILE_POINT,
  FLOW_TILES_NOW,
  FLOW_UPLOAD_REFERENCE,
  encodeBytes,
  type AcceptNoticeResponse,
  type ConfirmResponse,
  type UploadReferenceResponse,
  type DetailResponse,
  type TilesNowResponse,
  type Point,
  type PrepareResponse,
  type ToFlowTab,
} from './messages';
import { pressAt } from './press';

export interface PortDeps {
  send(tabId: number, message: ToFlowTab): Promise<unknown>;
  press(tabId: number, x: number, y: number): Promise<void>;
  wait(ms: number): Promise<void>;
  getZoom(tabId: number): Promise<number>;
  /** The Flow tab closed Flow's "What's new" announcement while answering (the background logs it). */
  onAnnouncement?(tabId: number): void;
  /** Flow's Account details panel, or the Agent panel / Agent mode, couldn't be closed again (the background logs it). */
  onLeftOpen?(tabId: number, what: 'account' | 'agent'): void;
}

const defaultDeps: PortDeps = {
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  press: pressAt,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  getZoom: (tabId) => chrome.tabs.getZoom(tabId),
};

/**
 * Plan 3's Flow work (clips, spike S8; Agent questions, spikes S6/S7), beside the coordinator's FlowPort. As there,
 * the Flow helper does the DOM work and answers with coordinates; only the background presses.
 */
export interface FlowMotionPort {
  /** Sets Video · Frames · aspect · 720p · length · x1, Agent off, attaches the start frame, types; where Generate is. */
  prepareClip(tabId: number, prompt: string, options: ClipOptions): Promise<Point>;
  /** Uploads a clip's start picture into the Flow project (skipped when it's already there). */
  uploadStartFrame(tabId: number, name: string, image: Blob): Promise<void>;
  /** "Generating will use N credits" as Flow shows it now; null when it doesn't. */
  generateCost(tabId: number): Promise<number | null>;
  /** The Account details balance (project grid page; the panel is closed again); null when unreadable. */
  creditBalance(tabId: number): Promise<CreditBalance | null>;
  /** The grid's tiles including finished clips (video: true, keyed by position). */
  videoTiles(tabId: number): Promise<FlowResultCard[]>;
  /** On a clip's page: its prompt and edit id. */
  readVideoDetail(tabId: number): Promise<VideoDetailRead>;
  /** On a clip's page: the signed 720p file URL and its media id, or null. Flow also starts a browser download. */
  clipFile(tabId: number, timeoutMs?: number): Promise<ClipFile | null>;
  /** Agent mode on, the named pictures attached in order, the question typed; where send is (not pressed). */
  prepareAgentQuestion(tabId: number, names: string[], question: string): Promise<Point>;
  /** Waits up to timeoutMs for the Agent's reply to the question just sent (polled in short asks); null on timeout. */
  readAgentReply(tabId: number, timeoutMs: number): Promise<string | null>;
  /** Closes the Agent panel and turns Agent mode off; true when both are done. Never throws. */
  finishAgent(tabId: number): Promise<boolean>;
  /**
   * Right before the send press: true only while Agent mode is on and the prompt holds the prepared question (else the
   * press could be a real Generate). No answer or an error is false. Never throws.
   */
  agentReady(tabId: number): Promise<boolean>;
  /** prepare → press send → read the reply, always finishing the Agent afterwards (also on timeout or error). */
  askAgent(tabId: number, names: string[], question: string, timeoutMs: number): Promise<string | null>;
}

const CLIP_FILE_TIMEOUT_MS = 20_000;
/** Each reply ask waits at most this long, so the service worker hears from the tab often while the Agent thinks. */
const AGENT_REPLY_SLICE_MS = 10_000;

const HELPER_ATTEMPTS = 20;
const HELPER_RETRY_MS = 1_000;
// Also retried: Flow reloads its page right after a new project opens, closing a request's channel mid-way.
// Retrying is safe: requests sent through ask() read, type, or (prepare) click Flow's own settings radios (mode, aspect,
// outputs), which are idempotent: each click is guarded by confirmed(), so a repeat finds it already set. The Generate
// press is done by the background, never here.
const helperMissing = (err: unknown) =>
  /receiving end does not exist|could not establish connection|message channel closed/i.test(
    err instanceof Error ? err.message : String(err),
  );

/**
 * The coordinator's FlowPort. The Flow helper (content script) does the DOM work and answers with coordinates; the
 * background presses. Preparing and pressing are separate so the coordinator can re-check the run in between.
 */
export function createFlowPort(over: Partial<PortDeps> = {}): FlowPort & FlowMotionPort {
  const deps: PortDeps = { ...defaultDeps, ...over };
  async function ask(tabId: number, message: ToFlowTab): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        const reply = await deps.send(tabId, message);
        if ((reply as { announcement?: unknown } | null | undefined)?.announcement === true) deps.onAnnouncement?.(tabId);
        return reply;
      } catch (err) {
        // A freshly opened or navigated Flow tab may not have loaded the helper yet.
        if (!helperMissing(err)) throw err;
        if (attempt >= HELPER_ATTEMPTS) {
          throw new FlowBlockedError({
            type: 'needsOwner',
            reason: 'page-not-recognised',
            message: "VidFlow can't reach the Flow page. Check the VidFlow Flow window has loaded, then press Resume.",
          });
        }
        await deps.wait(HELPER_RETRY_MS);
      }
    }
  }

  async function point(tabId: number, message: ToFlowTab): Promise<Point> {
    const reply = (await ask(tabId, message)) as PrepareResponse | undefined;
    if (!reply) throw new Error('The Flow page gave no answer.');
    if (reply.kind === 'blocked') throw new FlowBlockedError(reply.event, reply.notice === true);
    if (reply.kind === 'error') throw new Error(reply.message);
    return { x: reply.x, y: reply.y };
  }

  /** A done / blocked / error answer: blocks become FlowBlockedError, errors Error. */
  function settled<T extends { kind: string }>(reply: T | undefined): Exclude<T, { kind: 'blocked' } | { kind: 'error' }> {
    if (!reply) throw new Error('The Flow page gave no answer.');
    const r = reply as unknown as { kind: string; event?: unknown; notice?: boolean; message?: string };
    if (r.kind === 'blocked') throw new FlowBlockedError(r.event as FlowBlockedError['event'], r.notice === true);
    if (r.kind === 'error') throw new Error(r.message);
    return reply as Exclude<T, { kind: 'blocked' } | { kind: 'error' }>;
  }

  async function press(tabId: number, x: number, y: number): Promise<void> {
    // Coordinates are CSS px; CDP wants them at the tab's zoom. VidFlow sets zoom to 100%, this covers it failing.
    let zoom = 1;
    try {
      zoom = (await deps.getZoom(tabId)) || 1;
    } catch {
      zoom = 1;
    }
    await deps.press(tabId, x * zoom, y * zoom);
  }

  const prepareAgentQuestion = (tabId: number, names: string[], question: string) =>
    point(tabId, { type: FLOW_AGENT_PREPARE, names, question });

  async function readAgentReply(tabId: number, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return null;
      const slice = Math.min(left, AGENT_REPLY_SLICE_MS);
      const started = Date.now();
      const reply = settled((await ask(tabId, { type: FLOW_AGENT_REPLY, waitMs: slice })) as AgentReplyResponse | undefined);
      if (reply.kind === 'reply') return reply.text;
      if (reply.kind === 'lost') return null; // the page reloaded: no reply will come
      // An early "waiting" (e.g. the tab answered at once): wait the slice out rather than ask back to back.
      const spent = Date.now() - started;
      if (spent < slice) await deps.wait(slice - spent);
    }
  }

  async function agentReady(tabId: number): Promise<boolean> {
    try {
      const reply = (await ask(tabId, { type: FLOW_AGENT_READY })) as AgentReadyResponse | undefined;
      return reply?.ready === true;
    } catch {
      return false;
    }
  }

  async function finishAgent(tabId: number): Promise<boolean> {
    try {
      const reply = (await ask(tabId, { type: FLOW_AGENT_FINISH })) as AgentFinishResponse | undefined;
      return reply?.done === true;
    } catch {
      return false;
    }
  }

  return {
    prepare: (tabId, _sceneId, prompt, options = {}) => point(tabId, { type: FLOW_PREPARE, prompt, ...options }),

    prepareClip: (tabId, prompt, options) => point(tabId, { type: FLOW_PREPARE_CLIP, prompt, ...options }),

    async uploadStartFrame(tabId, name, image) {
      // Retrying after a dropped channel is safe: the helper skips the upload when the asset is already there.
      const data = encodeBytes(new Uint8Array(await image.arrayBuffer()));
      settled(
        (await ask(tabId, { type: FLOW_UPLOAD_START_FRAME, name, mimeType: image.type || 'image/png', data })) as
          | UploadStartFrameResponse
          | undefined,
      );
    },

    async generateCost(tabId) {
      const reply = (await ask(tabId, { type: FLOW_GENERATE_COST })) as GenerateCostResponse | undefined;
      return typeof reply?.cost === 'number' ? reply.cost : null;
    },

    async creditBalance(tabId) {
      const reply = settled((await ask(tabId, { type: FLOW_CREDIT_BALANCE })) as CreditBalanceResponse | undefined);
      if (reply.panelOpen === true) deps.onLeftOpen?.(tabId, 'account');
      return reply.balance;
    },

    async videoTiles(tabId) {
      const reply = (await ask(tabId, { type: FLOW_VIDEO_TILES_NOW })) as TilesNowResponse | undefined;
      return reply?.cards ?? [];
    },

    async readVideoDetail(tabId) {
      const reply = (await ask(tabId, { type: FLOW_VIDEO_DETAIL })) as VideoDetailResponse | undefined;
      return { prompt: reply?.prompt ?? null, editId: reply?.editId ?? null, startFrame: null };
    },

    async clipFile(tabId, timeoutMs = CLIP_FILE_TIMEOUT_MS) {
      const reply = (await ask(tabId, { type: FLOW_CLIP_FILE, timeoutMs })) as ClipFileResponse | undefined;
      return reply?.file ?? null;
    },

    prepareAgentQuestion,
    readAgentReply,
    finishAgent,
    agentReady,

    async askAgent(tabId, names, question, timeoutMs) {
      // Every way out finishes the Agent, also when preparing failed (no answer, the tab unreachable).
      try {
        let at = await prepareAgentQuestion(tabId, names, question);
        // Send is pressed only while the Agent is on with the question in its prompt (else it could be Generate):
        // prepared once more if not, and never pressed when it still isn't (no answer).
        if (!(await agentReady(tabId))) {
          at = await prepareAgentQuestion(tabId, names, question);
          if (!(await agentReady(tabId))) return null;
        }
        await press(tabId, at.x, at.y);
        return await readAgentReply(tabId, timeoutMs);
      } finally {
        if (!(await finishAgent(tabId))) deps.onLeftOpen?.(tabId, 'agent');
      }
    },

    findNewProject: (tabId, verb: StartVerb) => point(tabId, { type: FLOW_NEW_PROJECT, verb }),

    press,

    tilePoint: (tabId, key) => point(tabId, { type: FLOW_TILE_POINT, key }),

    async uploadReference(tabId, name, image) {
      // Retrying after a dropped channel is safe too: the helper skips the upload when the asset is already there.
      const data = encodeBytes(new Uint8Array(await image.arrayBuffer()));
      const reply = (await ask(tabId, { type: FLOW_UPLOAD_REFERENCE, name, mimeType: image.type || 'image/png', data })) as
        | UploadReferenceResponse
        | undefined;
      if (!reply) throw new Error('The Flow page gave no answer.');
      if (reply.kind === 'blocked') throw new FlowBlockedError(reply.event, reply.notice === true);
      if (reply.kind === 'error') throw new Error(reply.message);
      return reply.mediaId;
    },

    async tiles(tabId) {
      const reply = (await ask(tabId, { type: FLOW_TILES_NOW })) as TilesNowResponse | undefined;
      return reply?.cards ?? [];
    },

    async readDetail(tabId) {
      const reply = (await ask(tabId, { type: FLOW_DETAIL })) as DetailResponse | undefined;
      return { prompt: reply?.prompt ?? null, mediaId: reply?.mediaId ?? null };
    },

    async acceptNotice(tabId) {
      try {
        const reply = (await ask(tabId, { type: FLOW_ACCEPT_NOTICE })) as AcceptNoticeResponse | undefined;
        if (!reply) return null;
        return reply.gone === true ? 'gone' : reply.accepted === true;
      } catch {
        return null; // no answer: the page may have reloaded after accepting
      }
    },

    async confirmStarted(tabId) {
      try {
        const reply = (await ask(tabId, { type: FLOW_CONFIRM })) as ConfirmResponse | undefined;
        if (reply?.started === true) return true;
        if (reply?.billing === true) return 'billing';
        return reply?.notice === true ? 'notice' : false;
      } catch {
        return false;
      }
    },
  };
}

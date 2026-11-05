/// <reference types="chrome" />
import type { FlowPort } from '../runs/coordinator';
import type { StartVerb } from './driver';
import {
  FlowBlockedError,
  FLOW_ACCEPT_NOTICE,
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
}

const defaultDeps: PortDeps = {
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  press: pressAt,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  getZoom: (tabId) => chrome.tabs.getZoom(tabId),
};

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
export function createFlowPort(deps: PortDeps = defaultDeps): FlowPort {
  async function ask(tabId: number, message: ToFlowTab): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await deps.send(tabId, message);
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

  return {
    prepare: (tabId, _sceneId, prompt, options = {}) => point(tabId, { type: FLOW_PREPARE, prompt, ...options }),

    findNewProject: (tabId, verb: StartVerb) => point(tabId, { type: FLOW_NEW_PROJECT, verb }),

    async press(tabId, x, y) {
      // Coordinates are CSS px; CDP wants them at the tab's zoom. VidFlow sets zoom to 100%, this covers it failing.
      let zoom = 1;
      try {
        zoom = (await deps.getZoom(tabId)) || 1;
      } catch {
        zoom = 1;
      }
      await deps.press(tabId, x * zoom, y * zoom);
    },

    tilePoint: (tabId, key) => point(tabId, { type: FLOW_TILE_POINT, key }),

    async uploadReference(tabId, name, image) {
      // Retrying after a dropped channel is safe too: the helper skips the upload when the asset is already there.
      const data = encodeBytes(new Uint8Array(await image.arrayBuffer()));
      const reply = (await ask(tabId, { type: FLOW_UPLOAD_REFERENCE, name, mimeType: image.type || 'image/png', data })) as
        | UploadReferenceResponse
        | undefined;
      if (!reply) throw new Error('The Flow page gave no answer.');
      if (reply.kind === 'blocked') throw new FlowBlockedError(reply.event);
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
        return reply?.accepted === true;
      } catch {
        return false;
      }
    },

    async confirmStarted(tabId) {
      try {
        const reply = (await ask(tabId, { type: FLOW_CONFIRM })) as ConfirmResponse | undefined;
        return reply?.started === true;
      } catch {
        return false;
      }
    },
  };
}

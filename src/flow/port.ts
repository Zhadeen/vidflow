/// <reference types="chrome" />
import type { FlowPort } from '../runs/coordinator';
import { FlowBlockedError, FLOW_PREPARE, type PrepareRequest, type PrepareResponse } from './messages';
import { pressAt } from './press';

export interface PortDeps {
  send(tabId: number, message: PrepareRequest): Promise<PrepareResponse | undefined>;
  press(tabId: number, x: number, y: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

const defaultDeps: PortDeps = {
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message) as Promise<PrepareResponse | undefined>,
  press: pressAt,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const HELPER_ATTEMPTS = 20;
const HELPER_RETRY_MS = 1_000;
const helperMissing = (err: unknown) =>
  /receiving end does not exist|could not establish connection/i.test(err instanceof Error ? err.message : String(err));

/** The coordinator's FlowPort: the Flow helper prepares the prompt, then the background presses Generate. */
export function createFlowPort(deps: PortDeps = defaultDeps): FlowPort {
  async function prepare(tabId: number, message: PrepareRequest): Promise<PrepareResponse | undefined> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await deps.send(tabId, message);
      } catch (err) {
        // A freshly opened Flow window may not have loaded the helper yet.
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

  return {
    async submit(tabId, _sceneId, prompt, options = {}) {
      const reply = await prepare(tabId, { type: FLOW_PREPARE, prompt, ...options });
      if (!reply) throw new Error('The Flow page gave no answer.');
      if (reply.kind === 'blocked') throw new FlowBlockedError(reply.event);
      if (reply.kind === 'error') throw new Error(reply.message);
      await deps.press(tabId, reply.x, reply.y);
    },
  };
}

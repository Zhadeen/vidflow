/// <reference types="chrome" />
import { checkCanStart, createFlowDriver, type FlowResultCard } from '../flow/driver';
import {
  FLOW_EVENT,
  FLOW_PILL,
  FLOW_PILL_TOGGLE,
  FLOW_PREPARE,
  FLOW_TILES,
  type PillResponse,
  type PrepareRequest,
  type PrepareResponse,
  type ToBackground,
} from '../flow/messages';
import { placePill, renderPill } from '../flow/pill';
import { LIMIT_PATTERN, POLICY_DIALOG_PATTERN, SEL } from '../flow/selectors';
import type { RunEvent } from '../runs/run';
import { getExpectedAccount } from '../settings';

const OBSERVE_THROTTLE_MS = 1_000;

export default defineContentScript({
  matches: ['https://flow.google.com/*', 'https://labs.google/fx/*'],
  main() {
    const driver = createFlowDriver();
    /** True while VidFlow is running (or paused) a run in this tab; only then does this tab report anything. */
    let active = false;

    const send = (message: ToBackground) => {
      try {
        void chrome.runtime.sendMessage(message).catch(() => undefined);
      } catch {
        // The extension was reloaded; this old helper can no longer talk to it.
      }
    };
    const report = (event: RunEvent) => send({ type: FLOW_EVENT, event });

    async function prepare(req: PrepareRequest): Promise<PrepareResponse> {
      try {
        const state = driver.read();
        const check = checkCanStart(state, await getExpectedAccount());
        if (!check.ok) return { kind: 'blocked', event: { type: 'needsOwner', reason: check.reason, message: check.message } };
        if (state.limitMessage) return { kind: 'blocked', event: { type: 'limit', message: state.limitMessage, resumeAt: null } };
        if (req.aspect) await driver.setAspect(req.aspect);
        if (req.outputs) await driver.setOutputs(req.outputs);
        const at = await driver.prepareSubmit(req.prompt);
        return { kind: 'ready', ...at };
      } catch (err) {
        return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      if (message?.type !== FLOW_PREPARE) return;
      void prepare(message as PrepareRequest).then(sendResponse);
      return true; // answer asynchronously
    });

    // ---- Pill ---------------------------------------------------------------
    async function refreshPill(): Promise<void> {
      let view: PillResponse = null;
      try {
        view = (await chrome.runtime.sendMessage({ type: FLOW_PILL } satisfies ToBackground)) as PillResponse;
      } catch {
        view = null;
      }
      active = view !== null;
      renderPill(document, view, (action) => send({ type: FLOW_PILL_TOGGLE, action }));
      if (active) observe();
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ('vidflow.run' in changes || 'vidflow.flowWindow' in changes)) void refreshPill();
    });
    window.addEventListener('resize', () => placePill(document));
    void refreshPill();

    // ---- Observing the page ------------------------------------------------
    let lastTiles = '';
    let lastLimit: string | null = null;
    let lastPolicy = false;
    const seenNotices = new Set<string>();

    function check(): void {
      if (!active) return;
      placePill(document);
      const cards: FlowResultCard[] = driver.resultCards();
      const tiles = JSON.stringify(cards);
      if (tiles !== lastTiles) {
        lastTiles = tiles;
        send({ type: FLOW_TILES, cards });
      }
      const state = driver.read();
      if (state.limitMessage && state.limitMessage !== lastLimit) {
        report({ type: 'limit', message: state.limitMessage, resumeAt: null });
      }
      lastLimit = state.limitMessage;
      if (state.policyDialog && !lastPolicy) {
        report({
          type: 'needsOwner',
          reason: 'policy-dialog',
          message: 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Resume.',
        });
      }
      lastPolicy = state.policyDialog;
      // Spike S5 never saw Flow's limit or refusal wording: log anything new so the patterns can be completed.
      for (const el of document.querySelectorAll(`${SEL.notice}, ${SEL.dialog}`)) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text || seenNotices.has(text) || LIMIT_PATTERN.test(text) || POLICY_DIALOG_PATTERN.test(text)) continue;
        seenNotices.add(text);
        console.info('[VidFlow] Flow message not recognised:', text);
      }
    }

    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function observe(): void {
      if (observer) return;
      observer = new MutationObserver(() => {
        timer ??= setTimeout(() => {
          timer = null;
          check();
        }, OBSERVE_THROTTLE_MS);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      check();
    }
  },
});

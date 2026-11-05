/// <reference types="chrome" />
import { checkCanStart, createFlowDriver, type FlowResultCard, type FlowSnapshot } from '../flow/driver';
import {
  FLOW_CONFIRM,
  FLOW_DETAIL,
  FLOW_EVENT,
  FLOW_NEW_PROJECT,
  FLOW_PILL,
  FLOW_PILL_TOGGLE,
  FLOW_PREPARE,
  FLOW_TILES,
  FLOW_TILE_POINT,
  FLOW_TILES_NOW,
  type ConfirmResponse,
  type DetailResponse,
  type NewProjectRequest,
  type PillResponse,
  type PrepareRequest,
  type PrepareResponse,
  type TilePointRequest,
  type TilesNowResponse,
  type ToBackground,
} from '../flow/messages';
import { placePill, renderPill } from '../flow/pill';
import { LIMIT_PATTERN, POLICY_DIALOG_PATTERN, SEL } from '../flow/selectors';
import type { RunEvent } from '../runs/run';
import { getExpectedAccount } from '../settings';

const OBSERVE_THROTTLE_MS = 1_000;
const READY_WAIT_MS = 10_000; // Flow may still be rendering a project it just opened
const CONFIRM_WAIT_MS = 8_000;
const DETAIL_WAIT_MS = 10_000; // the detail page renders its History panel after the picture

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

    /** Taken right after typing, so the background's confirm can tell whether its press started a picture. */
    let beforePress: FlowSnapshot | null = null;
    const failure = (err: unknown): PrepareResponse => ({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    });

    async function prepare(req: PrepareRequest): Promise<PrepareResponse> {
      try {
        await driver.waitUntilReady(READY_WAIT_MS);
        const state = driver.read();
        const check = checkCanStart(state, await getExpectedAccount(), req.verb ?? 'Start');
        if (!check.ok) return { kind: 'blocked', event: { type: 'needsOwner', reason: check.reason, message: check.message } };
        if (state.limitMessage) return { kind: 'blocked', event: { type: 'limit', message: state.limitMessage, resumeAt: null } };
        await driver.setImageMode();
        if (req.aspect) await driver.setAspect(req.aspect);
        if (req.outputs) await driver.setOutputs(req.outputs);
        const at = await driver.prepareSubmit(req.prompt);
        beforePress = driver.snapshot();
        return { kind: 'ready', ...at };
      } catch (err) {
        return failure(err);
      }
    }

    async function newProject(req: NewProjectRequest): Promise<PrepareResponse> {
      try {
        const deadline = Date.now() + READY_WAIT_MS;
        while (!driver.newProjectButton() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
        // The home page has no prompt bar, so only the account and dialog checks apply here.
        const check = checkCanStart({ ...driver.read(), ready: true }, await getExpectedAccount(), req.verb);
        if (!check.ok) return { kind: 'blocked', event: { type: 'needsOwner', reason: check.reason, message: check.message } };
        const at = driver.newProjectButton();
        if (!at) {
          const message = `VidFlow can't find Flow's New project button. Open Flow's home page in the VidFlow window, then press ${req.verb}.`;
          return { kind: 'blocked', event: { type: 'needsOwner', reason: 'page-not-recognised', message } };
        }
        return { kind: 'ready', ...at };
      } catch (err) {
        return failure(err);
      }
    }

    async function confirm(): Promise<ConfirmResponse> {
      if (!beforePress) return { started: false };
      const started = await driver.waitForStart(beforePress, CONFIRM_WAIT_MS);
      beforePress = null;
      return { started };
    }

    async function tilePoint(req: TilePointRequest): Promise<PrepareResponse> {
      // Right after VidFlow returns from a detail page, Flow may still be drawing the list.
      const deadline = Date.now() + READY_WAIT_MS;
      let at = driver.tilePoint(req.key);
      while (!at && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        at = driver.tilePoint(req.key);
      }
      if (!at) return { kind: 'error', message: "VidFlow can't find that picture in Flow's list." };
      await new Promise((r) => setTimeout(r, 300)); // let the scroll settle, then measure again
      const settled = driver.tilePoint(req.key) ?? at;
      return { kind: 'ready', ...settled };
    }

    async function detail(): Promise<DetailResponse> {
      const deadline = Date.now() + DETAIL_WAIT_MS;
      let read = driver.readDetailPrompt();
      while ((read.prompt === null || read.mediaId === null) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        read = driver.readDetailPrompt();
      }
      return read;
    }

    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      const handlers: Record<string, () => Promise<unknown>> = {
        [FLOW_PREPARE]: () => prepare(message as PrepareRequest),
        [FLOW_NEW_PROJECT]: () => newProject(message as NewProjectRequest),
        [FLOW_CONFIRM]: () => confirm(),
        [FLOW_TILES_NOW]: async (): Promise<TilesNowResponse> => ({ cards: driver.resultCards() }),
        [FLOW_TILE_POINT]: () => tilePoint(message as TilePointRequest),
        [FLOW_DETAIL]: () => detail(),
      };
      const handle = message?.type ? handlers[message.type] : undefined;
      if (!handle) return;
      void handle().then(sendResponse);
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

    // Development-only end-to-end bridge: this branch is removed from the normal build.
    if (import.meta.env.MODE === 'e2e') {
      void import('../e2e/page-bridge').then((m) =>
        m.installPageBridge(window, (message) => chrome.runtime.sendMessage(message)),
      );
    }

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

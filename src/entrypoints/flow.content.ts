/// <reference types="chrome" />
import { installPageBridge } from '../e2e/page-bridge';
import {
  checkCanStart,
  createFlowDriver,
  policyDialogMessage,
  type FlowPageState,
  type FlowResultCard,
  type FlowSnapshot,
  type StartCheck,
} from '../flow/driver';
import {
  FLOW_ACCEPT_NOTICE,
  FLOW_CHECKS,
  FLOW_CONFIRM,
  FLOW_SHOW_ME,
  FLOW_TEST_PROMPT,
  FLOW_DETAIL,
  FLOW_EVENT,
  FLOW_NEW_PROJECT,
  FLOW_NOTICE,
  FLOW_PILL,
  FLOW_PILL_TOGGLE,
  FLOW_PREPARE,
  FLOW_TILES,
  FLOW_TILE_POINT,
  FLOW_TILES_NOW,
  FLOW_UPLOAD_REFERENCE,
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
  FlowBlockedError,
  CLIP_ASPECT_MESSAGE,
  type AgentFinishResponse,
  type AgentReadyResponse,
  type AgentPrepareRequest,
  type AgentReplyRequest,
  type AgentReplyResponse,
  type ClipFileRequest,
  type ClipFileResponse,
  type CreditBalanceResponse,
  type GenerateCostResponse,
  type PrepareClipRequest,
  type UploadStartFrameRequest,
  type UploadStartFrameResponse,
  type VideoDetailResponse,
  TEST_PROMPT_TEXT,
  decodeBytes,
  testPromptRefusal,
  type AcceptNoticeResponse,
  type ChecksRequest,
  type FlowChecksResponse,
  type ShowMeResponse,
  type TestPromptRequest,
  type TestPromptResponse,
  type ConfirmResponse,
  type UploadReferenceRequest,
  type UploadReferenceResponse,
  type DetailResponse,
  type NewProjectRequest,
  type PillResponse,
  type PrepareRequest,
  type PrepareResponse,
  type TilePointRequest,
  type TilesNowResponse,
  type ToBackground,
} from '../flow/messages';
import { renderHighlight } from '../flow/highlight';
import { createRefresher, placeLive, renderLive } from '../flow/live';
import { BILLING_PATTERN, LIMIT_PATTERN, SEL, USAGE_NOTICE_PATTERN } from '../flow/selectors';
import type { RunEvent } from '../runs/run';
import { STEP_KEY } from '../runs/activity';
import { getAcceptNotices, getExpectedAccount, getLiveActivity, LIVE_ACTIVITY_KEY } from '../settings';

const OBSERVE_THROTTLE_MS = 1_000;
const READY_WAIT_MS = 10_000; // Flow may still be rendering a project it just opened
const CONFIRM_WAIT_MS = 8_000;
const DETAIL_WAIT_MS = 10_000; // the detail page renders its History panel after the picture
const CHECKS_WAIT_MS = 5_000; // Flow may still be drawing its page
const CHECKS_MAX_WAIT_MS = 30_000;
const SHOW_ME_MS = 4_000; // Show me in Flow: each control is ringed in turn, about this long in all

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
    // A FlowBlockedError (e.g. the hero reference wouldn't attach) pauses the run; anything else fails the scene.
    const failure = (err: unknown): PrepareResponse =>
      err instanceof FlowBlockedError
        ? { kind: 'blocked', event: err.event, ...(err.notice ? { notice: true as const } : {}) }
        : { kind: 'error', message: err instanceof Error ? err.message : String(err) };

    /**
     * A failed start check, as the answer to the background. Blocked only by Flow's usage notice (no billing dialog):
     * marked `notice`, so the background may accept it (switch on) and ask again.
     */
    const blockedBy = (check: Extract<StartCheck, { ok: false }>, state: FlowPageState): PrepareResponse => ({
      kind: 'blocked',
      event: { type: 'needsOwner', reason: check.reason, message: check.message },
      ...(check.reason === 'policy-dialog' && state.noticeDialog && !state.billingDialog ? { notice: true as const } : {}),
    });

    async function prepare(req: PrepareRequest): Promise<PrepareResponse> {
      try {
        await driver.waitUntilReady(READY_WAIT_MS);
        const state = driver.read();
        const check = checkCanStart(state, await getExpectedAccount(), req.verb ?? 'Start');
        if (!check.ok) return blockedBy(check, state);
        if (state.limitMessage) return { kind: 'blocked', event: { type: 'limit', message: state.limitMessage, resumeAt: null } };
        await driver.setImageMode();
        if (req.aspect) await driver.setAspect(req.aspect);
        if (req.outputs) await driver.setOutputs(req.outputs);
        await driver.turnOffAgentMode(); // sticky in Flow: with it on, the prompt would go to the Agent
        // Generate clears the chip, so the reference is attached again for every prompt (spike S7).
        if (req.reference) await driver.attachReference(req.reference.name);
        const at = await driver.prepareSubmit(req.prompt, { reference: !!req.reference });
        beforePress = driver.snapshot();
        return { kind: 'ready', ...at };
      } catch (err) {
        return failure(err);
      }
    }

    /** The checks every prepare starts with: Flow drawn, account, dialogs, limit. A block to answer with, or null. */
    async function startChecks(verb: PrepareRequest['verb']): Promise<PrepareResponse | null> {
      await driver.waitUntilReady(READY_WAIT_MS);
      const state = driver.read();
      const check = checkCanStart(state, await getExpectedAccount(), verb ?? 'Start');
      if (!check.ok) return blockedBy(check, state);
      if (state.limitMessage) return { kind: 'blocked', event: { type: 'limit', message: state.limitMessage, resumeAt: null } };
      return null;
    }

    /** One clip (spike S8): Video · Frames · aspect · 720p · length · x1, Agent off, start frame attached, prompt typed. */
    async function prepareClip(req: PrepareClipRequest): Promise<PrepareResponse> {
      if (req.aspect !== '16:9' && req.aspect !== '9:16') return { kind: 'error', message: CLIP_ASPECT_MESSAGE };
      try {
        const stop = await startChecks(req.verb);
        if (stop) return stop;
        await driver.setVideoMode();
        await driver.setFramesMode();
        await driver.setAspect(req.aspect);
        await driver.setResolution720();
        await driver.setClipLength(req.length);
        await driver.setOutputs(1);
        await driver.turnOffAgentMode();
        // Generate clears the start frame (spike S8), so it is attached again for every clip.
        await driver.attachStartFrame(req.startFrame);
        const at = await driver.prepareSubmit(req.prompt, { startFrame: true });
        beforePress = driver.snapshot();
        return { kind: 'ready', ...at };
      } catch (err) {
        return failure(err);
      }
    }

    async function uploadStartFrame(req: UploadStartFrameRequest): Promise<UploadStartFrameResponse> {
      try {
        await driver.waitUntilReady(READY_WAIT_MS);
        await driver.uploadStartFrame(new File([decodeBytes(req.data)], req.name, { type: req.mimeType }));
        return { kind: 'done' };
      } catch (err) {
        return failure(err) as UploadStartFrameResponse;
      }
    }

    async function creditBalance(): Promise<CreditBalanceResponse> {
      try {
        const balance = await driver.readCreditBalance();
        return { kind: 'done', balance, ...(driver.accountPanelOpen() ? { panelOpen: true as const } : {}) };
      } catch (err) {
        return failure(err) as CreditBalanceResponse;
      }
    }

    async function videoDetail(): Promise<VideoDetailResponse> {
      const deadline = Date.now() + DETAIL_WAIT_MS;
      let read = driver.readVideoDetail();
      while (read.prompt === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        read = driver.readVideoDetail();
      }
      return read;
    }

    /** Agent question (spikes S6/S7): attach the pictures in order and type; the background presses send. */
    async function agentPrepare(req: AgentPrepareRequest): Promise<PrepareResponse> {
      try {
        const stop = await startChecks('Resume');
        if (stop) return stop;
        return { kind: 'ready', ...(await driver.prepareAgentQuestion(req.names, req.question)) };
      } catch (err) {
        return failure(err);
      }
    }

    async function agentReply(req: AgentReplyRequest): Promise<AgentReplyResponse> {
      if (!driver.agentQuestionPending()) return { kind: 'lost' };
      try {
        const text = await driver.readAgentReply(req.waitMs);
        return text === null ? { kind: 'waiting' } : { kind: 'reply', text };
      } catch (err) {
        return failure(err) as AgentReplyResponse;
      }
    }

    async function newProject(req: NewProjectRequest): Promise<PrepareResponse> {
      try {
        const deadline = Date.now() + READY_WAIT_MS;
        while (!driver.newProjectButton() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
        // The home page has no prompt bar, so only the account and dialog checks apply here.
        const state = { ...driver.read(), ready: true };
        const check = checkCanStart(state, await getExpectedAccount(), req.verb);
        if (!check.ok) return blockedBy(check, state);
        const at = driver.newProjectButton();
        if (!at) {
          const then = req.verb === 'Test' ? 'try again' : `press ${req.verb}`;
          const message = `VidFlow can't find Flow's New project button. Open Flow's home page in the VidFlow window, then ${then}.`;
          return { kind: 'blocked', event: { type: 'needsOwner', reason: 'page-not-recognised', message } };
        }
        return { kind: 'ready', ...at };
      } catch (err) {
        return failure(err);
      }
    }

    async function uploadReference(req: UploadReferenceRequest): Promise<UploadReferenceResponse> {
      try {
        await driver.waitUntilReady(READY_WAIT_MS);
        const file = new File([decodeBytes(req.data)], req.name, { type: req.mimeType });
        return { kind: 'done', mediaId: await driver.uploadReference(file) };
      } catch (err) {
        return failure(err) as UploadReferenceResponse;
      }
    }

    /** Only on VidFlow's own Flow tab, and only while the switch is on; the driver never touches a billing dialog. */
    async function acceptNotice(): Promise<AcceptNoticeResponse> {
      if (!active || !(await getAcceptNotices())) return { accepted: false };
      try {
        // Nothing showing any more (the run's own step accepted it meanwhile): say so, so nothing pauses for it.
        const state = driver.read();
        if (!state.noticeDialog && !state.billingDialog) return { accepted: false, gone: true };
        return { accepted: await driver.acceptNotice() };
      } catch {
        return { accepted: false };
      }
    }

    /** The Checks tab's facts: read only (no menu opened, nothing clicked). */
    async function checks(req: ChecksRequest): Promise<FlowChecksResponse> {
      const seen = () =>
        !!document.querySelector(SEL.account) || !!document.querySelector(SEL.promptBox) || !!driver.newProjectButton();
      const deadline = Date.now() + Math.min(req.waitMs ?? CHECKS_WAIT_MS, CHECKS_MAX_WAIT_MS);
      while (!seen() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      const state = driver.read();
      return {
        account: state.signedInEmail,
        page: seen(),
        promptBox: !!document.querySelector(SEL.promptBox),
        generate: !!document.querySelector(SEL.generate),
        agentOff: !driver.agentModeOn(),
        ...driver.readSettings(),
        credits: driver.readCredits(),
        creditsResets: driver.readCreditsResets(),
        noticeDialog: state.noticeDialog,
        billingDialog: state.billingDialog,
      };
    }

    /** Show me in Flow: rings the prompt box, Generate and the ingredients button in turn (the §17 ring). */
    function showMe(): ShowMeResponse {
      const parts = [
        { name: 'prompt box', tag: 'Prompt box', el: document.querySelector(SEL.promptBox) },
        { name: 'Generate button', tag: 'Generate', el: document.querySelector(SEL.generate) },
        { name: 'ingredients button', tag: 'Ingredients (hero picture)', el: document.querySelector(SEL.ingredients) },
      ];
      const found = parts.filter((p) => p.el);
      const each = found.length ? SHOW_ME_MS / found.length : 0;
      found.forEach((p, i) => setTimeout(() => !active && renderHighlight(document, p.el, p.tag), i * each));
      if (found.length) setTimeout(() => !active && renderHighlight(document, null, null), SHOW_ME_MS);
      return { missing: parts.filter((p) => !p.el).map((p) => p.name) };
    }

    /** Test one prompt: settings, Agent mode off, type, wait for Generate to be ready, clear. Never presses Generate. */
    async function testPrompt(req: TestPromptRequest): Promise<TestPromptResponse> {
      // The same rule as the background's: a running run, or a paused one, keeps this tab.
      const refusal = active ? testPromptRefusal(view?.paused ? 'paused' : 'running') : null;
      if (refusal) return { ok: false, message: refusal };
      let typed = false;
      try {
        if (!(await driver.waitUntilReady(READY_WAIT_MS))) {
          return { ok: false, message: "VidFlow can't find Flow's prompt box. Check the Flow window, then try again." };
        }
        const state = driver.read();
        const check = checkCanStart(state, await getExpectedAccount(), 'Test');
        if (!check.ok) return { ok: false, message: check.message };
        await driver.setImageMode();
        await driver.setAspect(req.aspect);
        await driver.setOutputs(req.outputs);
        await driver.turnOffAgentMode();
        typed = true;
        await driver.prepareSubmit(TEST_PROMPT_TEXT); // waits for Flow to enable Generate; nothing is pressed
        const cleared = await driver.clearPrompt();
        return {
          ok: true,
          message: cleared
            ? `Flow is ready: Image · ${req.aspect} · x${req.outputs}, the test prompt typed and Generate ready. The test prompt was cleared.`
            : `Flow is ready: Image · ${req.aspect} · x${req.outputs} and Generate ready, but the test prompt is still in the box. Clear it in the Flow window.`,
        };
      } catch (err) {
        if (typed) await driver.clearPrompt().catch(() => false);
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, message: message.replace(/,? then press Resume\.$/, ', then try again.') };
      }
    }

    async function confirm(): Promise<ConfirmResponse> {
      if (!beforePress) return { started: false };
      const started = await driver.waitForStart(beforePress, CONFIRM_WAIT_MS);
      beforePress = null;
      if (!started) {
        // Flow may have answered Generate with its usage notice: say so, so the background can accept it.
        const state = driver.read();
        if (state.billingDialog) return { started, billing: true };
        if (state.noticeDialog) return { started, notice: true };
      }
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
        [FLOW_UPLOAD_REFERENCE]: () => uploadReference(message as UploadReferenceRequest),
        [FLOW_ACCEPT_NOTICE]: () => acceptNotice(),
        [FLOW_CHECKS]: () => checks(message as ChecksRequest),
        [FLOW_SHOW_ME]: async () => showMe(),
        [FLOW_TEST_PROMPT]: () => testPrompt(message as TestPromptRequest),
        [FLOW_PREPARE_CLIP]: () => prepareClip(message as PrepareClipRequest),
        [FLOW_UPLOAD_START_FRAME]: () => uploadStartFrame(message as UploadStartFrameRequest),
        [FLOW_GENERATE_COST]: async (): Promise<GenerateCostResponse> => ({ cost: await driver.readGenerateCost().catch(() => null) }),
        [FLOW_CREDIT_BALANCE]: () => creditBalance(),
        [FLOW_VIDEO_TILES_NOW]: async (): Promise<TilesNowResponse> => ({ cards: driver.videoResultCards() }),
        [FLOW_VIDEO_DETAIL]: () => videoDetail(),
        [FLOW_CLIP_FILE]: async (): Promise<ClipFileResponse> => ({
          file: await driver.clipFileUrl((message as ClipFileRequest).timeoutMs).catch(() => null),
        }),
        [FLOW_AGENT_PREPARE]: () => agentPrepare(message as AgentPrepareRequest),
        [FLOW_AGENT_REPLY]: () => agentReply(message as AgentReplyRequest),
        [FLOW_AGENT_FINISH]: async (): Promise<AgentFinishResponse> => ({ done: await driver.finishAgent() }),
        [FLOW_AGENT_READY]: async (): Promise<AgentReadyResponse> => ({ ready: driver.agentReady() }),
      };
      const handle = message?.type ? handlers[message.type] : undefined;
      if (!handle) return;
      // Flow's "What's new" announcement is closed before any step (it would cover the page) and by the driver's own
      // waits; the answer says so, and the background logs "Closed Flow's announcement".
      const closedBefore = driver.announcementsClosed();
      driver.dismissAnnouncement();
      void handle().then((reply) =>
        sendResponse(
          driver.announcementsClosed() > closedBefore && reply && typeof reply === 'object'
            ? { ...(reply as object), announcement: true }
            : reply,
        ),
      );
      return true; // answer asynchronously
    });

    // ---- Pill and live activity (ring, tags, saved badges) ------------------
    let view: PillResponse = null;
    let liveOn = true;
    const refreshPill = createRefresher(
      async () => (await chrome.runtime.sendMessage({ type: FLOW_PILL } satisfies ToBackground)) as PillResponse,
      getLiveActivity,
      (next, on) => {
        view = next;
        active = view !== null;
        if (active) liveOn = on;
        renderLive(document, view, liveOn, (action) => send({ type: FLOW_PILL_TOGGLE, action }));
        if (active) observe();
      },
    );
    /** Keeps the ring and badges on their targets: at most once a frame, only while this tab is VidFlow's. */
    let placing = false;
    function placeSoon(): void {
      if (!active || placing) return;
      placing = true;
      requestAnimationFrame(() => {
        placing = false;
        placeLive(document, view, liveOn);
      });
    }
    // The run and the Flow window decide whether this is VidFlow's tab; the step and the switch only matter if it is.
    const RUN_KEYS = ['vidflow.run', 'vidflow.flowWindow'];
    const LIVE_KEYS = [STEP_KEY, LIVE_ACTIVITY_KEY];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (RUN_KEYS.some((key) => key in changes) || (active && LIVE_KEYS.some((key) => key in changes))) void refreshPill();
    });
    window.addEventListener('resize', placeSoon);
    window.addEventListener('scroll', placeSoon, { capture: true, passive: true }); // Flow scrolls inner lists
    void refreshPill();

    // Development-only end-to-end bridge: this branch is removed from the normal build.
    if (import.meta.env.MODE === 'e2e') {
      installPageBridge(window, (message) => chrome.runtime.sendMessage(message));
    }

    // ---- Observing the page ------------------------------------------------
    let lastTiles = '';
    let lastLimit: string | null = null;
    let lastBilling = false;
    let lastNotice = false;
    const seenNotices = new Set<string>();

    function check(): void {
      if (!active) return;
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
      const policy = { type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage('Resume') } as const;
      // A billing dialog always stops the run. A usage notice does with the switch off; with it on, the background is
      // told and accepts it (even while the run only waits for tiles, with no prepare to find it), or pauses.
      if (state.billingDialog && !lastBilling) report(policy);
      else if (state.noticeDialog && !lastNotice) {
        void getAcceptNotices().then((on) => (on ? send({ type: FLOW_NOTICE }) : report(policy)));
      }
      lastBilling = state.billingDialog;
      lastNotice = state.noticeDialog;
      // Spike S5 never saw Flow's limit or refusal wording: log anything new so the patterns can be completed.
      for (const el of document.querySelectorAll(`${SEL.notice}, ${SEL.dialog}`)) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text || seenNotices.has(text) || LIMIT_PATTERN.test(text) || USAGE_NOTICE_PATTERN.test(text) || BILLING_PATTERN.test(text)) continue;
        seenNotices.add(text);
        console.info('[VidFlow] Flow message not recognised:', text);
      }
    }

    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function observe(): void {
      if (observer) return;
      observer = new MutationObserver(() => {
        placeSoon(); // Flow re-drew something: the ring and badges follow within a frame
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

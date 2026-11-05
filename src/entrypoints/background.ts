/// <reference types="chrome" />
import { isOwnPage, registerToolbar } from '../background/action';
import { registerE2e } from '../e2e/background';
import {
  FLOW_EVENT,
  FLOW_PILL,
  FLOW_PILL_TOGGLE,
  FLOW_TILES,
  flowTabEvent,
  RUN_GET,
  RUN_PAUSE,
  RUN_RESUME,
  RUN_RETRY,
  RUN_START,
  RUN_STATE,
  RUN_STOP,
  RUN_SKIP,
  RUN_FORGET,
  RUN_CHOOSE,
  RUN_HERO_SHEET,
  RUN_CHECKS,
  RUN_OPEN_FLOW,
  RUN_SHOW_ME,
  RUN_TEST_PROMPT,
  type ChecksReply,
  type ChecksToolRequest,
  type OpenFlowReply,
  type ShowMeReply,
  type TestPromptReply,
  type RunReply,
  type RunStateMessage,
  type StudioRequest,
  type ToBackground,
} from '../flow/messages';
import { createFlowPort } from '../flow/port';
import {
  RunBlockedError,
  chooseScenePicture,
  discardFinishedRun,
  getRunState,
  handleFlowEvent,
  onRunState,
  handleTiles,
  isFlowTab,
  pauseRun,
  pillFor,
  registerCoordinator,
  resumeRun,
  retryScene,
  setFlowPort,
  setStartChecks,
  skipCurrent,
  startHeroSheetRun,
  startRun,
  stopRun,
} from '../runs/coordinator';
import { openFlow, runChecks, showMeInFlow, startChecks, testOnePrompt } from '../runs/checks';

/** Runs a studio request and answers with the run as it is afterwards, or the plain reason it was refused. */
async function answerStudio(message: StudioRequest): Promise<RunReply> {
  try {
    switch (message.type) {
      case RUN_START:
        await startRun(message.projectId);
        break;
      case RUN_PAUSE:
        await pauseRun();
        break;
      case RUN_RESUME:
        await resumeRun();
        break;
      case RUN_RETRY:
        await retryScene(message.projectId, message.sceneId);
        break;
      case RUN_STOP:
        await stopRun();
        break;
      case RUN_SKIP:
        await skipCurrent();
        break;
      case RUN_FORGET:
        await discardFinishedRun(message.projectId);
        break;
      case RUN_CHOOSE:
        await chooseScenePicture(message.projectId, message.sceneId, message.pictureId);
        break;
      case RUN_HERO_SHEET:
        await startHeroSheetRun(message.projectId);
        break;
      case RUN_GET:
        break;
    }
    return { ok: true, state: getRunState() };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: e instanceof RunBlockedError ? 'busy' : 'error', message: text };
  }
}

type ChecksToolReply = ChecksReply | OpenFlowReply | ShowMeReply | TestPromptReply;

/** The Checks tab's tools; a refusal or failure comes back as its plain message. */
async function answerChecks(message: ChecksToolRequest): Promise<ChecksToolReply> {
  try {
    switch (message.type) {
      case RUN_CHECKS:
        return { ok: true, ...(await runChecks(message.projectId)) };
      case RUN_OPEN_FLOW:
        await openFlow();
        return { ok: true };
      case RUN_SHOW_ME:
        return { ok: true, ...(await showMeInFlow()) };
      case RUN_TEST_PROMPT:
        return await testOnePrompt(message.projectId);
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const CHECKS_TYPES = new Set<string>([RUN_CHECKS, RUN_OPEN_FLOW, RUN_SHOW_ME, RUN_TEST_PROMPT]);

const STUDIO_TYPES = new Set<string>([
  RUN_GET,
  RUN_START,
  RUN_PAUSE,
  RUN_RESUME,
  RUN_RETRY,
  RUN_STOP,
  RUN_SKIP,
  RUN_FORGET,
  RUN_CHOOSE,
  RUN_HERO_SHEET,
  ...CHECKS_TYPES,
]);

export default defineBackground(() => {
  registerCoordinator();
  // Development-only end-to-end hook: this branch is removed from the normal build.
  if (import.meta.env.MODE === 'e2e') {
    registerE2e(true, chrome.runtime.onMessage as never, chrome.runtime.id);
  }
  // Set synchronously on every worker start, so a plain wake never finds the run "not connected".
  setFlowPort(createFlowPort());
  // Every Start runs the Checks first (spec §19). Not in the e2e build: its scripted starts drive Flow as before.
  if (import.meta.env.MODE !== 'e2e') setStartChecks(startChecks);

  // Every run change goes to the studio tab and the side panel (if open; nothing listening is fine).
  onRunState((state) => {
    const message: RunStateMessage = { type: RUN_STATE, state };
    chrome.runtime.sendMessage(message).catch(() => undefined);
  });

  chrome.runtime.onMessage.addListener((message: ToBackground | StudioRequest | ChecksToolRequest, sender, sendResponse) => {
    if (STUDIO_TYPES.has(message?.type)) {
      // Only VidFlow's own pages may control runs (content scripts in Flow tabs share this channel).
      if (!isOwnPage(sender)) return;
      if (CHECKS_TYPES.has(message.type)) void answerChecks(message as ChecksToolRequest).then(sendResponse);
      else void answerStudio(message as StudioRequest).then(sendResponse);
      return true; // answer asynchronously
    }
    message = message as ToBackground;
    const tabId = sender.tab?.id;
    switch (message?.type) {
      case FLOW_EVENT: {
        // Only VidFlow's own Flow tab may move the run, and only by pausing it (limit, needs the owner).
        const event = flowTabEvent(message.event);
        if (!event) return;
        void isFlowTab(tabId).then((ours) => (ours ? handleFlowEvent(event) : undefined));
        return;
      }
      case FLOW_TILES:
        // Raw tile observations from VidFlow's own Flow tab; the coordinator matches them to scenes.
        void isFlowTab(tabId).then((ours) => (ours ? handleTiles(message.cards) : undefined));
        return;
      case FLOW_PILL:
        void pillFor(tabId).then(sendResponse, () => sendResponse(null));
        return true; // answer asynchronously
      case FLOW_PILL_TOGGLE:
        void isFlowTab(tabId).then((ours) => {
          if (ours) return message.action === 'pause' ? pauseRun() : resumeRun();
        });
        return;
    }
  });

  // Toolbar: the side panel on a Flow tab, the studio anywhere else.
  registerToolbar();
});

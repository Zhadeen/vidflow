/// <reference types="chrome" />
import {
  FLOW_EVENT,
  FLOW_PILL,
  FLOW_PILL_TOGGLE,
  FLOW_TILES,
  RUN_GET,
  RUN_PAUSE,
  RUN_RESUME,
  RUN_RETRY,
  RUN_START,
  RUN_STATE,
  RUN_STOP,
  RUN_FORGET,
  type RunReply,
  type RunStateMessage,
  type StudioRequest,
  type ToBackground,
} from '../flow/messages';
import { createFlowPort } from '../flow/port';
import {
  RunBlockedError,
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
  startRun,
  stopRun,
} from '../runs/coordinator';

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
      case RUN_FORGET:
        await discardFinishedRun(message.projectId);
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

const STUDIO_TYPES = new Set<string>([RUN_GET, RUN_START, RUN_PAUSE, RUN_RESUME, RUN_RETRY, RUN_STOP, RUN_FORGET]);

export default defineBackground(() => {
  registerCoordinator();
  // Development-only end-to-end hook: this branch is removed from the normal build.
  if (import.meta.env.MODE === 'e2e') {
    void import('../e2e/background').then((m) =>
      m.registerE2e(true, chrome.runtime.onMessage as never, chrome.runtime.id),
    );
  }
  // Set synchronously on every worker start, so a plain wake never finds the run "not connected".
  setFlowPort(createFlowPort());

  const studioUrl = browser.runtime.getURL('/studio.html');

  // Every run change goes to the studio tab (if one is open; nothing listening is fine).
  onRunState((state) => {
    const message: RunStateMessage = { type: RUN_STATE, state };
    chrome.runtime.sendMessage(message).catch(() => undefined);
  });

  chrome.runtime.onMessage.addListener((message: ToBackground | StudioRequest, sender, sendResponse) => {
    if (STUDIO_TYPES.has(message?.type)) {
      // Only VidFlow's own studio page may control runs (content scripts in Flow tabs share this channel).
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(studioUrl)) return;
      void answerStudio(message as StudioRequest).then(sendResponse);
      return true; // answer asynchronously
    }
    message = message as ToBackground;
    const tabId = sender.tab?.id;
    switch (message?.type) {
      case FLOW_EVENT:
        // Only VidFlow's own Flow tab may move the run; other Flow tabs are the owner's own.
        void isFlowTab(tabId).then((ours) => (ours ? handleFlowEvent(message.event) : undefined));
        return;
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

  browser.action.onClicked.addListener(async () => {
    const [existing] = await browser.tabs.query({ url: studioUrl });
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await browser.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    await browser.tabs.create({ url: studioUrl });
  });
});

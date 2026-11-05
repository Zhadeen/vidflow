/// <reference types="chrome" />
import { FLOW_EVENT, FLOW_PILL, FLOW_PILL_TOGGLE, FLOW_TILES, type ToBackground } from '../flow/messages';
import { createFlowPort } from '../flow/port';
import {
  handleFlowEvent,
  isFlowTab,
  pauseRun,
  pillFor,
  registerCoordinator,
  resumeRun,
  setFlowPort,
} from '../runs/coordinator';

export default defineBackground(() => {
  registerCoordinator();
  // Set synchronously on every worker start, so a plain wake never finds the run "not connected".
  setFlowPort(createFlowPort());

  chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    switch (message?.type) {
      case FLOW_EVENT:
        // Only VidFlow's own Flow tab may move the run; other Flow tabs are the owner's own.
        void isFlowTab(tabId).then((ours) => (ours ? handleFlowEvent(message.event) : undefined));
        return;
      case FLOW_TILES:
        // Raw tile observations. Task 8 matches them to scenes (matchResults).
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

  const studioUrl = browser.runtime.getURL('/studio.html');

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

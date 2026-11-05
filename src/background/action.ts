/// <reference types="chrome" />
import { isFlowPage } from '../flow/hosts';
import { openStudio } from '../studio/openStudio';

/** VidFlow's own pages, which may control runs: the studio tab and the side panel. */
const OWN_PAGES = ['/studio.html', '/sidepanel.html'];

/**
 * True only for a message from one of VidFlow's own pages (content scripts in Flow tabs share the channel, and other
 * extensions can message too). The page must be exactly studio.html or sidepanel.html of this extension.
 */
export function isOwnPage(sender: { id?: string; url?: string }): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return OWN_PAGES.some((page) => {
      const own = new URL(chrome.runtime.getURL(page));
      return url.origin === own.origin && url.pathname === own.pathname;
    });
  } catch {
    return false;
  }
}

/** The toolbar click: no popup and openPanelOnActionClick stays off, so every click lands here. */
export function registerToolbar(): void {
  chrome.action.onClicked.addListener((tab) => {
    void openForTab(tab);
  });
}

/**
 * The toolbar button: on a Flow tab, VidFlow's side panel opens beside Flow; anywhere else, the studio tab.
 * Chrome only opens the side panel inside the click's user gesture, so the panel is asked for synchronously, before
 * anything is awaited. If Chrome still refuses, the studio opens instead.
 */
export async function openForTab(tab: { id?: number; windowId?: number; url?: string }): Promise<'panel' | 'studio'> {
  if (isFlowPage(tab.url) && tab.windowId !== undefined) {
    const opening = chrome.sidePanel.open({ windowId: tab.windowId });
    try {
      await opening;
      return 'panel';
    } catch {
      // Fall through to the studio.
    }
  }
  await openStudio();
  return 'studio';
}

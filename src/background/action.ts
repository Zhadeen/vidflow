/// <reference types="chrome" />
import { isFlowUrl } from '../flow/hosts';
import { openStudio } from '../studio/openStudio';

/**
 * The toolbar button: on a Flow tab, VidFlow's side panel opens beside Flow; anywhere else, the studio tab.
 * Chrome only opens the side panel inside the click's user gesture, so the panel is asked for synchronously, before
 * anything is awaited. If Chrome still refuses, the studio opens instead.
 */
export async function openForTab(tab: { id?: number; windowId?: number; url?: string }): Promise<'panel' | 'studio'> {
  if (isFlowUrl(tab.url) && tab.windowId !== undefined) {
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

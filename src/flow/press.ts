/// <reference types="chrome" />
/**
 * Trusted press in VidFlow's Flow tab. Spike S5: Flow's buttons ignore synthetic clicks, so the background presses
 * through chrome.debugger. Only ever called by the coordinator, for its own Flow tab, right after it re-checked the run
 * is still running.
 */
const PROTOCOL_VERSION = '1.3';
const alreadyAttached = (err: unknown) => /already attached/i.test(err instanceof Error ? err.message : String(err));

export async function pressAt(tabId: number, x: number, y: number): Promise<void> {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
  } catch (err) {
    if (!alreadyAttached(err)) throw err; // VidFlow attached earlier in this run
  }
  const mouse = (params: Record<string, unknown>) =>
    chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', params);
  await mouse({ type: 'mouseMoved', x, y });
  await mouse({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await mouse({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** Detach when a run pauses or finishes, so Chrome's "started debugging this browser" bar goes away. */
export async function detachFlowDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Not attached, or the tab is gone.
  }
}

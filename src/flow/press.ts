/// <reference types="chrome" />
/**
 * Trusted press on Flow's Generate button. Spike S5: Generate ignores synthetic clicks, so the background presses it
 * through chrome.debugger. Only ever called for the tab the coordinator stored as VidFlow's own Flow tab.
 */
const PROTOCOL_VERSION = '1.3';

async function isAttached(tabId: number): Promise<boolean> {
  const targets = await chrome.debugger.getTargets();
  return targets.some((t) => t.tabId === tabId && t.attached);
}

const notAttached = (err: unknown) => /not attached/i.test(err instanceof Error ? err.message : String(err));

export async function pressAt(tabId: number, x: number, y: number): Promise<void> {
  const target = { tabId };
  const mouse = (params: Record<string, unknown>) =>
    chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', params);
  const press = async () => {
    await mouse({ type: 'mouseMoved', x, y });
    await mouse({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await mouse({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  if (!(await isAttached(tabId))) await chrome.debugger.attach(target, PROTOCOL_VERSION);
  try {
    await press();
  } catch (err) {
    // Something else (e.g. DevTools) was attached, not VidFlow: attach ourselves and try once more.
    if (!notAttached(err)) throw err;
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
    await press();
  }
}

/** Detach when a run pauses or finishes, so Chrome's "started debugging this browser" bar goes away. */
export async function detachFlowDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Not attached, or the tab is gone.
  }
}

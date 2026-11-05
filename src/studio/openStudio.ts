/// <reference types="chrome" />

export const studioUrl = () => chrome.runtime.getURL('/studio.html');

/** Where the coordinator keeps VidFlow's own Flow window (src/runs/coordinator.ts). */
const FLOW_WINDOW_KEY = 'vidflow.flowWindow';

async function flowWindowId(): Promise<number | undefined> {
  try {
    const saved = (await chrome.storage.local.get(FLOW_WINDOW_KEY))[FLOW_WINDOW_KEY] as { windowId?: number } | undefined;
    return saved?.windowId;
  } catch {
    return undefined;
  }
}

/** A normal window other than VidFlow's Flow window (the focused one first), if there is one. */
async function otherWindowId(flowWindow: number): Promise<number | undefined> {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const others = windows.filter((w) => w.id !== undefined && w.id !== flowWindow && (w.type === undefined || w.type === 'normal'));
  return (others.find((w) => w.focused) ?? others[0])?.id;
}

/**
 * Brings the studio tab forward (opening it if there is none). With a project, the studio shows that project: an open
 * studio tab only changes its #hash, so it doesn't reload.
 *
 * Never inside VidFlow's own Flow window: Flow ignores VidFlow's presses while its tab isn't the shown tab there
 * (plan-1b live check), and the side panel usually sits in that window. A studio tab found there is moved out.
 */
export async function openStudio(projectId?: string): Promise<void> {
  const base = studioUrl();
  const url = projectId ? `${base}#/project/${projectId}` : base;
  const flowWindow = await flowWindowId();
  const studioTabs = await chrome.tabs.query({ url: base });
  const show = async (tabId: number, windowId: number | undefined) => {
    await chrome.tabs.update(tabId, projectId ? { active: true, url } : { active: true });
    if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true });
  };

  if (flowWindow === undefined) {
    const [existing] = studioTabs;
    if (existing?.id !== undefined) return show(existing.id, existing.windowId);
    await chrome.tabs.create({ url });
    return;
  }

  const outside = studioTabs.find((t) => t.id !== undefined && t.windowId !== flowWindow);
  if (outside?.id !== undefined) return show(outside.id, outside.windowId);

  const target = await otherWindowId(flowWindow);
  const trapped = studioTabs.find((t) => t.id !== undefined);
  if (trapped?.id !== undefined) {
    // Moved first, then shown: it is never made the shown tab of VidFlow's window.
    if (target !== undefined) {
      await chrome.tabs.move(trapped.id, { windowId: target, index: -1 });
      return show(trapped.id, target);
    }
    const created = await chrome.windows.create({ tabId: trapped.id, focused: true });
    return show(trapped.id, created?.id);
  }
  if (target !== undefined) {
    await chrome.tabs.create({ url, windowId: target, active: true });
    await chrome.windows.update(target, { focused: true });
    return;
  }
  await chrome.windows.create({ url, focused: true });
}

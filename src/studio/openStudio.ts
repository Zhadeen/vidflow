/// <reference types="chrome" />

export const studioUrl = () => chrome.runtime.getURL('/studio.html');

/**
 * Brings the studio tab forward (opening it if there is none). With a project, the studio shows that project: an open
 * studio tab only changes its #hash, so it doesn't reload.
 */
export async function openStudio(projectId?: string): Promise<void> {
  const base = studioUrl();
  const url = projectId ? `${base}#/project/${projectId}` : base;
  const [existing] = await chrome.tabs.query({ url: base });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, projectId ? { active: true, url } : { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

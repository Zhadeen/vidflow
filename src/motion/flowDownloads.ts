/**
 * Pressing "720p Original size" on a clip's page (spike S8) makes Flow's page save the clip in Downloads too. VidFlow
 * fetches the file itself, so that browser download is cancelled and erased, and its file removed if it had already
 * finished. Only a .mp4 from Flow's own hosts, started within a short window after VidFlow pressed it, is touched;
 * VidFlow's own downloads and everything else are left alone.
 */
export const FLOW_DOWNLOAD_WINDOW_MS = 10_000;

const FLOW_HOSTS = new Set(['flow.google.com', 'flow-content.google', 'labs.google']);

export interface FlowDownloadItem {
  id: number;
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename?: string;
  mime?: string;
  state?: string;
  byExtensionId?: string;
}

/** The parts of chrome.downloads the guard uses. */
export interface DownloadsApi {
  cancel(id: number): Promise<void>;
  search(query: { id: number }): Promise<Array<{ id: number; state?: string }>>;
  removeFile(id: number): Promise<void>;
  erase(query: { id: number }): Promise<number[]>;
}

/** The host a download comes from; a blob: URL counts as the page that made it. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('blob:') ? url.slice(5) : url);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

function isFlowClip(item: FlowDownloadItem): boolean {
  const urls = [item.url, item.finalUrl];
  if (!urls.some((u) => FLOW_HOSTS.has(hostOf(u) ?? ''))) return false;
  if (/\.mp4$/i.test(item.filename ?? '') || /^video\/mp4\b/i.test(item.mime ?? '')) return true;
  // Before Chrome has named it: Flow's signed clip address is flow-content.google/video/<id>.
  return urls.some((u) => hostOf(u) === 'flow-content.google' && /^https:\/\/flow-content\.google\/video\//.test(u ?? ''));
}

export function createFlowDownloadGuard(api: DownloadsApi, ownExtensionId: string, now: () => number = Date.now) {
  let until = Number.NEGATIVE_INFINITY;
  return {
    /** VidFlow is about to press Flow's download: its download may start within the window. */
    expect(windowMs = FLOW_DOWNLOAD_WINDOW_MS): void {
      until = now() + windowMs;
    },
    /** chrome.downloads.onCreated: true when this was Flow's clip download and it was cancelled and erased. */
    async onCreated(item: FlowDownloadItem): Promise<boolean> {
      if (now() > until) return false;
      if (item.byExtensionId && item.byExtensionId === ownExtensionId) return false;
      if (!isFlowClip(item)) return false;
      await api.cancel(item.id).catch(() => undefined);
      const [after] = await api.search({ id: item.id }).catch(() => [] as Array<{ id: number; state?: string }>);
      if ((after?.state ?? item.state) === 'complete') await api.removeFile(item.id).catch(() => undefined);
      await api.erase({ id: item.id }).catch(() => undefined);
      return true;
    },
  };
}

import { vi } from 'vitest';

type Delta = { id: number; state?: { current: string } };

/**
 * A fake chrome.downloads: each download gets a new id and, unless told otherwise, is already complete under
 * ~/Downloads/<filename>. `rename` changes the name Chrome "chose" (uniquify); `hold` leaves a download in progress
 * until `finish` or `interrupt` fires its onChanged event.
 */
export function fakeDownloads() {
  let next = 0;
  const items = new Map<number, { id: number; filename: string; state: string }>();
  const listeners = new Set<(d: Delta) => void>();
  const renames = new Map<string, string>();
  let holding = false;
  const download = vi.fn(async (opts: chrome.downloads.DownloadOptions) => {
    const id = ++next;
    const name = renames.get(opts.filename!) ?? opts.filename!;
    items.set(id, { id, filename: `/Users/me/Downloads/${name}`, state: holding ? 'in_progress' : 'complete' });
    return id;
  });
  const search = vi.fn(async (q: { id?: number }) => {
    const item = q.id === undefined ? undefined : items.get(q.id);
    return item ? [{ ...item }] : [];
  });
  const fire = (id: number, state: 'complete' | 'interrupted') => {
    items.get(id)!.state = state;
    for (const l of [...listeners]) l({ id, state: { current: state } });
  };
  return {
    api: {
      download,
      search,
      onChanged: { addListener: (l: (d: Delta) => void) => listeners.add(l), removeListener: (l: (d: Delta) => void) => listeners.delete(l) },
    },
    download,
    search,
    listeners,
    rename: (requested: string, actual: string) => renames.set(requested, actual),
    hold: (on = true) => void (holding = on),
    finish: (id: number) => fire(id, 'complete'),
    interrupt: (id: number) => fire(id, 'interrupted'),
  };
}

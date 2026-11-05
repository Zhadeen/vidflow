import { useEffect, useRef, useState } from 'react';
import type { MediaStore } from '../store/media';

/**
 * Loads pictures from the media store as object URLs. Each picture is read once and kept while it is still wanted;
 * URLs are revoked when a picture is no longer wanted and when the screen closes.
 */
export function usePictureUrls(media: MediaStore, ids: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());
  const key = ids.join('|');

  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(ids);
    for (const [id, url] of cache.current) {
      if (!wanted.has(id)) {
        URL.revokeObjectURL(url);
        cache.current.delete(id);
      }
    }
    void (async () => {
      for (const id of ids) {
        if (cancelled) return;
        if (cache.current.has(id)) continue;
        try {
          const blob = await media.get(id);
          if (cancelled) return;
          if (blob && typeof URL.createObjectURL === 'function') cache.current.set(id, URL.createObjectURL(blob));
        } catch {
          // A missing file shows as an empty frame; the scene can be made again.
        }
      }
      if (!cancelled) setUrls(Object.fromEntries(cache.current));
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for `ids`.
  }, [media, key]);

  useEffect(() => {
    const owned = cache.current;
    return () => {
      for (const url of owned.values()) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  return urls;
}

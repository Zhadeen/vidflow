import { useEffect, useState } from 'react';
import { clampLimit } from './view';

/**
 * The credit limit field of a Motion run (spec §20): defaults to the estimate, can be lowered, never stays above it.
 * An empty field goes back to the estimate on blur, a typed value is clamped on blur, and a lower estimate (fewer clips
 * picked) brings a higher limit down with it. `value` is what Make clips sends.
 */
export function useClipLimit(needed: number) {
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    setTyped((t) => (t !== null && t.trim() !== '' && Number(t) > needed ? String(needed) : t));
  }, [needed]);
  return {
    text: typed ?? String(needed),
    value: clampLimit(typed ?? '', needed),
    onChange: (text: string) => setTyped(text),
    onBlur: () => setTyped((t) => (t === null || t.trim() === '' ? null : String(clampLimit(t, needed)))),
  };
}

export type ClipLimit = ReturnType<typeof useClipLimit>;

/** Said when the limit is 0: a run that may spend nothing would make no clip. */
export const LIMIT_ZERO_MESSAGE = 'Set a credit limit above 0.';

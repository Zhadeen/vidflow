import { CREAM, FONT, NAVY, OVERLAY_Z } from './colors';
import { SEL } from './selectors';

const HOST_ID = 'vidflow-badges';
const INSET = 8;

function tileOf(img: Element): Element {
  return img.closest(SEL.tile) ?? img.closest(`${SEL.tileList} > *`) ?? img;
}

/** The scrolling box a tile is shown in (Flow's virtual-scroll viewport), so badges never float outside it. */
function clipOf(tile: Element): { top: number; bottom: number } | null {
  const viewport = tile.closest('cdk-virtual-scroll-viewport');
  if (!viewport) return null;
  const r = viewport.getBoundingClientRect();
  return r.height > 0 ? { top: r.top, bottom: r.bottom } : null;
}

/**
 * Marks each picture VidFlow saved with "✓ Saved · scene N" (look-only), top-right on its tile. `saved` maps a card
 * key (Flow media id) to its scene number; an empty map removes every badge.
 */
export function renderSavedBadges(doc: Document, saved: Map<string, number>): void {
  let host = doc.getElementById(HOST_ID);
  if (saved.size === 0) {
    host?.remove();
    return;
  }
  if (!host) {
    host = doc.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: OVERLAY_Z });
    host.attachShadow({ mode: 'open' });
    doc.documentElement.append(host);
  }
  const root = host.shadowRoot!;
  const vw = doc.defaultView?.innerWidth ?? 0;
  const vh = doc.defaultView?.innerHeight ?? 0;
  const existing = new Map([...root.querySelectorAll<HTMLElement>('.badge')].map((b) => [b.dataset.key!, b]));
  const keep = new Set<string>();

  for (const img of doc.querySelectorAll<HTMLElement>(SEL.tileImage)) {
    const key = img.dataset.mediaId;
    const scene = key ? saved.get(key) : undefined;
    if (!key || scene === undefined || keep.has(key)) continue;
    keep.add(key);
    let badge = existing.get(key);
    if (!badge) {
      badge = doc.createElement('div');
      badge.className = 'badge';
      badge.dataset.key = key;
      Object.assign(badge.style, {
        position: 'fixed',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        whiteSpace: 'nowrap',
        background: NAVY,
        color: CREAM,
        border: `1px solid ${CREAM}`,
        borderRadius: '999px',
        padding: '3px 8px',
        font: `700 11px/1.4 ${FONT}`,
      });
      root.append(badge);
    }
    const text = `✓ Saved · scene ${scene}`;
    if (badge.textContent !== text) badge.textContent = text;

    const tile = tileOf(img);
    const r = tile.getBoundingClientRect();
    const top = r.top + INSET;
    const clip = clipOf(tile) ?? { top: 0, bottom: vh || Infinity };
    const visible = r.width > 0 && top >= clip.top && top + 20 <= clip.bottom;
    const style: Record<string, string> = {
      display: visible ? 'block' : 'none',
      top: `${Math.round(top)}px`,
      right: `${Math.round(vw - r.right + INSET)}px`,
    };
    for (const [k, v] of Object.entries(style)) {
      if ((badge.style as unknown as Record<string, string>)[k] !== v) (badge.style as unknown as Record<string, string>)[k] = v;
    }
  }
  for (const [key, badge] of existing) if (!keep.has(key)) badge.remove();
  if (!root.querySelector('.badge')) host.remove();
}

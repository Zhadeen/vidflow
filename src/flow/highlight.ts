import type { StepTarget } from '../runs/activity';
import { CORAL, FONT, NAVY, OVERLAY_Z } from './colors';
import { findNewProjectButton, tileContainer, tileImage } from './driver';
import { SEL } from './selectors';

/** The short tag beside the ring, by what VidFlow is touching. "N" is the scene number (see tagFor). */
export const TAG: Record<Exclude<StepTarget, null>, string> = {
  project: 'Opening a new project',
  setting: 'Setting this',
  prompt: 'Typing here',
  generate: 'Pressing Generate',
  tile: 'Checking it matches scene N…',
};

export function tagFor(target: Exclude<StepTarget, null>, scene: number | null): string {
  if (target !== 'tile') return TAG[target];
  return scene === null ? 'Checking it matches its scene…' : TAG.tile.replace('N', String(scene));
}

/** The element on Flow's page that a step is about, or null when it isn't on the page right now. */
export function findTarget(doc: Document, target: Exclude<StepTarget, null>, key?: string): Element | null {
  switch (target) {
    case 'project':
      return findNewProjectButton(doc);
    case 'setting':
      return doc.querySelector(SEL.settingsTrigger);
    case 'prompt':
      return doc.querySelector(SEL.promptBox);
    case 'generate':
      return doc.querySelector(SEL.generate);
    case 'tile': {
      const img = key ? tileImage(doc, key) : null;
      return img ? tileContainer(img) : null;
    }
  }
}

const HOST_ID = 'vidflow-highlight';
const OUTSET = 7; // the ring sits this far outside a control
const TAG_GAP = 14; // between the control and its tag
const FADE_MS = 200;
const HALO = 'rgba(255, 107, 91, 0.25)';

const STYLE = `
.ring, .tag { position: fixed; pointer-events: none; box-sizing: border-box; animation: vf-in ${FADE_MS}ms ease-out; transition: opacity ${FADE_MS}ms ease-out; }
.leaving { opacity: 0; }
@keyframes vf-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ring, .tag { animation: none; transition: none; } }
`;

interface Shown {
  target: Element;
  tag: string;
  ring: HTMLElement;
  label: HTMLElement;
}
const shown = new WeakMap<Document, Shown>();

function hostOf(doc: Document): ShadowRoot {
  let host = doc.getElementById(HOST_ID);
  if (!host) {
    host = doc.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: OVERLAY_Z });
    const root = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    root.append(style);
    doc.documentElement.append(host);
  }
  return host.shadowRoot!;
}

function fadeOut(doc: Document, els: HTMLElement[]): void {
  for (const el of els) el.classList.add('leaving');
  setTimeout(() => {
    for (const el of els) el.remove();
    const host = doc.getElementById(HOST_ID);
    if (host && !host.shadowRoot?.querySelector('.ring, .tag')) host.remove();
  }, FADE_MS + 20);
}

const px = (n: number) => `${Math.round(n)}px`;
function set(el: HTMLElement, style: Record<string, string>): void {
  for (const [k, v] of Object.entries(style)) {
    if ((el.style as unknown as Record<string, string>)[k] !== v) (el.style as unknown as Record<string, string>)[k] = v;
  }
}

function place(doc: Document, s: Shown): void {
  const r = s.target.getBoundingClientRect();
  const view = doc.defaultView;
  const vw = view?.innerWidth ?? 0;
  const vh = view?.innerHeight ?? 0;
  const hidden = !s.target.isConnected || (r.width === 0 && r.height === 0);
  set(s.ring, { display: hidden ? 'none' : 'block' });
  set(s.label, { display: hidden ? 'none' : 'block' });
  if (hidden) return;

  // A picture tile gets an inside ring with the tag in its corner; a control gets a ring around it, the tag above.
  const tile = s.target.matches(SEL.tileImage) || s.target.querySelector(SEL.tileImage) !== null;
  const out = tile ? 0 : OUTSET;
  const radius = (() => {
    if (!tile && r.width <= 48 && Math.abs(r.width - r.height) <= 4) return '50%';
    const own = parseFloat(view?.getComputedStyle(s.target).borderTopLeftRadius ?? '') || (tile ? 10 : 8);
    return px(own + out);
  })();
  set(s.ring, {
    left: px(r.left - out),
    top: px(r.top - out),
    width: px(r.width + 2 * out),
    height: px(r.height + 2 * out),
    borderRadius: radius,
    boxShadow: tile ? 'none' : `0 0 0 6px ${HALO}`, // as the mockup: a halo round controls, a plain inside ring on a tile
  });

  if (tile) {
    set(s.label, { left: px(r.left + 8), top: px(r.top + 8), right: '', bottom: '' });
  } else if (r.top - TAG_GAP > 32) {
    set(s.label, { right: px(Math.max(4, vw - (r.right + 10))), bottom: px(vh - (r.top - TAG_GAP)), left: '', top: '' });
  } else {
    set(s.label, { right: px(Math.max(4, vw - (r.right + 10))), top: px(r.bottom + TAG_GAP), left: '', bottom: '' });
  }
}

/**
 * Draws a coral ring and tag on the element VidFlow is touching (look-only: clicks pass straight through). The same tag
 * on a moved or re-drawn target follows it; a new tag fades the old ring out; a null target removes it.
 */
export function renderHighlight(doc: Document, target: Element | null, tag: string | null): void {
  let current = shown.get(doc);
  if (current && !current.ring.isConnected) {
    shown.delete(doc); // the page removed our overlay: start again
    current = undefined;
  }
  if (!target || !tag) {
    if (current) {
      shown.delete(doc);
      fadeOut(doc, [current.ring, current.label]);
    }
    return;
  }
  if (current && current.tag === tag) {
    current.target = target;
    place(doc, current);
    return;
  }
  if (current) fadeOut(doc, [current.ring, current.label]);

  const root = hostOf(doc);
  const ring = doc.createElement('div');
  ring.className = 'ring';
  Object.assign(ring.style, {
    pointerEvents: 'none',
    border: `3px solid ${CORAL}`,
  });
  const label = doc.createElement('div');
  label.className = 'tag';
  label.textContent = tag;
  Object.assign(label.style, {
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    background: CORAL,
    color: NAVY,
    font: `700 11px/1.4 ${FONT}`,
    padding: '4px 9px',
    borderRadius: '999px',
  });
  root.append(ring, label);
  const next = { target, tag, ring, label };
  shown.set(doc, next);
  place(doc, next);
}

import type { RunState } from '../runs/run';
import { SEL } from './selectors';

export interface PillView {
  n: number;
  total: number;
  paused: boolean;
}

const NAVY = '#14213D';
const CREAM = '#F4EDE0';
const CORAL = '#FF6B5B';
const HOST_ID = 'vidflow-pill';
const GAP = 16;
const MIN_PILL_WIDTH = 240;

/** What the pill shows for a run, or null when nothing is running (hidden). n = the picture being worked on. */
export function pillView(state: RunState | null): PillView | null {
  if (!state || (state.status !== 'running' && state.status !== 'paused')) return null;
  const scenes = Object.values(state.sceneStates);
  const started = scenes.filter((s) => s.status !== 'pending').length;
  const total = scenes.length;
  return { n: Math.min(total, Math.max(1, started)), total, paused: state.status === 'paused' };
}

/** Bottom offset (px) that keeps the pill off Flow's prompt bar: 16px, or just above the bar when they'd overlap. */
export function pillBottom(
  promptBar: { left: number; right: number; top: number } | null,
  viewportHeight: number,
  pill: { left: number; width: number },
): number {
  if (!promptBar) return GAP;
  const overlapsHorizontally = pill.left < promptBar.right && pill.left + pill.width > promptBar.left;
  const barHeightFromBottom = viewportHeight - promptBar.top;
  if (!overlapsHorizontally || barHeightFromBottom <= 0) return GAP;
  return Math.max(GAP, barHeightFromBottom + 8);
}

/** Draws (or removes, when view is null) the pill in Flow's page. Isolated in a shadow root. */
export function renderPill(
  doc: Document,
  view: PillView | null,
  onToggle: (action: 'pause' | 'resume') => void,
): HTMLElement | null {
  let host = doc.getElementById(HOST_ID);
  if (!view) {
    host?.remove();
    return null;
  }
  if (!host) {
    host = doc.createElement('div');
    host.id = HOST_ID;
    host.attachShadow({ mode: 'open' });
    doc.body.append(host);
  }
  Object.assign(host.style, { position: 'fixed', left: `${GAP}px`, zIndex: '2147483647' });

  const root = host.shadowRoot!;
  root.replaceChildren();
  const pill = doc.createElement('div');
  pill.className = 'pill';
  Object.assign(pill.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 8px 8px 16px',
    borderRadius: '999px',
    background: NAVY,
    color: CREAM,
    font: '500 13px/1.2 system-ui, sans-serif',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  });
  const label = doc.createElement('span');
  label.textContent = `VidFlow · Picture ${view.n} of ${view.total}`;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = view.paused ? 'Resume' : 'Pause';
  Object.assign(button.style, {
    border: '0',
    borderRadius: '999px',
    padding: '6px 14px',
    background: CORAL,
    color: NAVY,
    font: 'inherit',
    fontWeight: '600',
    cursor: 'pointer',
  });
  button.addEventListener('click', () => onToggle(view.paused ? 'resume' : 'pause'));
  pill.append(label, button);
  root.append(pill);

  placePill(doc, host);
  return host;
}

/** Re-places an existing pill (call on resize / layout changes). */
export function placePill(doc: Document, host = doc.getElementById(HOST_ID)): void {
  if (!host) return;
  const bar = doc.querySelector(SEL.promptBar)?.getBoundingClientRect() ?? null;
  const width = Math.max(host.getBoundingClientRect().width, MIN_PILL_WIDTH);
  const viewportHeight = doc.defaultView?.innerHeight ?? 0;
  const bottom = `${pillBottom(bar && bar.width > 0 ? bar : null, viewportHeight, { left: GAP, width })}px`;
  if (host.style.bottom !== bottom) host.style.bottom = bottom; // no-op writes would re-trigger the page observer
}

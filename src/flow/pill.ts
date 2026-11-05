import type { RunState } from '../runs/run';
import { CORAL, CREAM, CREAM_MUTED, FONT, NAVY, NAVY_BORDER, NAVY_TRACK } from './colors';
import { SEL } from './selectors';

export interface PillView {
  n: number;
  total: number;
  paused: boolean;
  /** What VidFlow is doing now, in plain words ("Pressing Generate"); null between steps and while paused. */
  step: string | null;
  /** The scene the step is about, as its place in the run ("Scene 2 of 3"), or null for a step not about one scene. */
  scene: number | null;
  saved: number;
  drawing: number;
  toGo: number;
}

const HOST_ID = 'vidflow-pill';
const GAP = 16;
const PILL_WIDTH = 250;

/** What the pill shows for a run, or null when nothing is running (hidden). n = the picture being worked on. */
export function pillView(
  state: RunState | null,
  step: { text: string; scene: number | null } | null = null,
): PillView | null {
  if (!state || (state.status !== 'running' && state.status !== 'paused')) return null;
  const scenes = Object.values(state.sceneStates);
  const count = (status: string) => scenes.filter((s) => s.status === status).length;
  const started = scenes.filter((s) => s.status !== 'pending').length;
  const total = scenes.length;
  return {
    n: Math.min(total, Math.max(1, started)),
    total,
    paused: state.status === 'paused',
    step: step?.text ?? null,
    scene: step?.scene ?? null,
    saved: count('done'),
    drawing: count('submitted'),
    toGo: count('pending'),
  };
}

/** Progress for the bar: saved pictures, plus half for those being drawn. */
export function pillProgress(view: Pick<PillView, 'saved' | 'drawing' | 'total'>): number {
  return view.total > 0 ? Math.round(((view.saved + view.drawing / 2) / view.total) * 100) : 0;
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
  // Look-only like the other overlays: only the Pause/Resume button takes clicks.
  Object.assign(host.style, { position: 'fixed', left: `${GAP}px`, zIndex: '2147483647', pointerEvents: 'none' });

  const root = host.shadowRoot!;
  root.replaceChildren();
  const el = (tag: string, className: string, style: Partial<CSSStyleDeclaration>, text?: string) => {
    const node = doc.createElement(tag);
    node.className = className;
    Object.assign(node.style, style);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const pill = el('div', 'pill', {
    boxSizing: 'border-box',
    width: `${PILL_WIDTH}px`,
    padding: '10px 12px',
    borderRadius: '14px',
    border: `1px solid ${NAVY_BORDER}`,
    background: NAVY,
    color: CREAM,
    font: `13px/1.4 ${FONT}`,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  });

  const head = el('div', 'head', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const title = el('b', 'title', { fontWeight: '700' }, 'VidFlow');
  const button = el(
    'button',
    'toggle',
    {
      border: '0',
      borderRadius: '999px',
      padding: '3px 10px',
      background: CORAL,
      color: NAVY,
      font: `700 11px/1.4 ${FONT}`,
      cursor: 'pointer',
      pointerEvents: 'auto',
    },
    view.paused ? 'Resume' : 'Pause',
  ) as HTMLButtonElement;
  button.type = 'button';
  button.addEventListener('click', () => onToggle(view.paused ? 'resume' : 'pause'));
  head.append(title, button);

  const line = el('div', 'step', { marginTop: '6px', fontSize: '12px' }); // long steps wrap rather than hide words
  if (view.step) {
    if (view.scene !== null) line.append(`Scene ${view.scene} of ${view.total} · `);
    line.append(el('b', '', { fontWeight: '700' }, view.step));
  } else line.textContent = `Picture ${view.n} of ${view.total}`;

  const track = el('div', 'track', { marginTop: '6px', height: '5px', borderRadius: '3px', background: NAVY_TRACK });
  track.append(el('div', 'fill', { width: `${pillProgress(view)}%`, height: '5px', borderRadius: '3px', background: CREAM }));

  const counts = el(
    'div',
    'counts',
    { marginTop: '6px', fontSize: '11px', color: CREAM_MUTED },
    `${view.saved} saved · ${view.drawing} being drawn · ${view.toGo} to go`,
  );

  pill.append(head, line, track, counts);
  root.append(pill);

  placePill(doc, host);
  return host;
}

/** Re-places an existing pill (call on resize / layout changes). */
export function placePill(doc: Document, host = doc.getElementById(HOST_ID)): void {
  if (!host) return;
  const bar = doc.querySelector(SEL.promptBar)?.getBoundingClientRect() ?? null;
  const width = Math.max(host.getBoundingClientRect().width, PILL_WIDTH);
  const viewportHeight = doc.defaultView?.innerHeight ?? 0;
  const bottom = `${pillBottom(bar && bar.width > 0 ? bar : null, viewportHeight, { left: GAP, width })}px`;
  if (host.style.bottom !== bottom) host.style.bottom = bottom; // no-op writes would re-trigger the page observer
}

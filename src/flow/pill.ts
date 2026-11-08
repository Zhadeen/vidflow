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
  /** The run makes the hero's model sheet: one prompt, so no picture counts or bar; the line names the sheet. */
  sheet?: boolean;
  /** A Motion run (clips) or an Auto-pick run: its line and counts say so (spec §20). */
  kind?: 'clips' | 'auto-pick';
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
  const settled = scenes.filter((s) => s.status !== 'pending' && s.status !== 'submitted').length;
  const total = scenes.length;
  const motion = state.kind === 'clips' || state.kind === 'auto-pick';
  return {
    // A clip or Auto-pick run counts the slide it is on: the ones finished, plus this one.
    n: Math.min(total, Math.max(1, motion ? settled + 1 : started)),
    total,
    paused: state.status === 'paused',
    step: step?.text ?? null,
    scene: step?.scene ?? null,
    saved: count('done'),
    drawing: count('submitted'),
    toGo: count('pending'),
    ...(state.kind === 'hero-sheet' ? { sheet: true } : {}),
    ...(state.kind === 'clips' || state.kind === 'auto-pick' ? { kind: state.kind } : {}),
  };
}

/**
 * The pill's line in two parts: the lead ("Scene 2 of 3 · ", "Clip 2 of 5 · ", "Picture 2 of 6") and the step in bold
 * (null between steps). The panel's Queue reads the same words.
 */
export function pillParts(view: PillView): { lead: string; step: string | null } {
  const at = view.scene ?? view.n;
  if (view.kind === 'auto-pick') {
    const lead = `Auto-picking slide ${at} of ${view.total}`;
    return view.step ? { lead: `${lead} · `, step: view.step } : { lead, step: null };
  }
  if (view.step) {
    if (view.scene === null) return { lead: '', step: view.step };
    return { lead: `${view.kind === 'clips' ? 'Clip' : 'Scene'} ${view.scene} of ${view.total} · `, step: view.step };
  }
  if (view.sheet) return { lead: 'Model sheet', step: null };
  return { lead: view.kind === 'clips' ? `Making clip ${view.n} of ${view.total}` : `Picture ${view.n} of ${view.total}`, step: null };
}

/** The pill's line as plain text. */
export const pillLine = (view: PillView): string => {
  const { lead, step } = pillParts(view);
  return `${lead}${step ?? ''}`;
};

/** The counts under the bar: pictures, clips or slides checked. */
export function pillCounts(view: PillView): string {
  if (view.sheet) return '';
  if (view.kind === 'clips') return `${view.saved} made · ${view.drawing} being made · ${view.toGo} to go`;
  if (view.kind === 'auto-pick') return `${view.saved} checked · ${view.toGo} to go`;
  return `${view.saved} saved · ${view.drawing} being drawn · ${view.toGo} to go`;
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
  // Built once, then updated in place: the Pause button stays the same element across refreshes, so its focus and a
  // press already under way survive a step change.
  let current = toggles.get(host);
  if (!current) {
    root.replaceChildren(); // e.g. a pill left by an earlier copy of this script
    current = buildPill(doc, root);
    toggles.set(host, current);
  }
  current.paused = view.paused;
  current.onToggle = onToggle;

  const button = root.querySelector<HTMLButtonElement>('.toggle')!;
  const label = view.paused ? 'Resume' : 'Pause';
  if (button.textContent !== label) button.textContent = label;

  const line = root.querySelector<HTMLElement>('.step')!;
  line.replaceChildren();
  const parts = pillParts(view);
  if (parts.lead) line.append(parts.lead);
  if (parts.step) {
    const b = doc.createElement('b');
    b.style.fontWeight = '700';
    b.textContent = parts.step;
    line.append(b);
  }

  root.querySelector<HTMLElement>('.fill')!.style.width = `${pillProgress(view)}%`;
  const counts = root.querySelector<HTMLElement>('.counts')!;
  counts.textContent = pillCounts(view);
  const show = view.sheet ? 'none' : '';
  for (const part of [counts, root.querySelector<HTMLElement>('.track')!]) if (part.style.display !== show) part.style.display = show;

  placePill(doc, host);
  return host;
}

/** What the one Pause/Resume button does now; updated on every refresh (the button and its listener are kept). */
interface PillToggle {
  paused: boolean;
  onToggle: (action: 'pause' | 'resume') => void;
}
const toggles = new WeakMap<HTMLElement, PillToggle>();

/** The pill's elements, made once per host. The parts that change are filled in by renderPill. */
function buildPill(doc: Document, root: ShadowRoot) {
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
  const button = el('button', 'toggle', {
    border: '0',
    borderRadius: '999px',
    padding: '3px 10px',
    background: CORAL,
    color: NAVY,
    font: `700 11px/1.4 ${FONT}`,
    cursor: 'pointer',
    pointerEvents: 'auto',
  }) as HTMLButtonElement;
  button.type = 'button';
  const state: PillToggle = { paused: false, onToggle: () => undefined };
  button.addEventListener('click', () => state.onToggle(state.paused ? 'resume' : 'pause'));
  head.append(title, button);

  const line = el('div', 'step', { marginTop: '6px', fontSize: '12px' }); // long steps wrap rather than hide words

  const track = el('div', 'track', { marginTop: '6px', height: '5px', borderRadius: '3px', background: NAVY_TRACK });
  track.append(el('div', 'fill', { width: '0%', height: '5px', borderRadius: '3px', background: CREAM }));

  const counts = el('div', 'counts', { marginTop: '6px', fontSize: '11px', color: CREAM_MUTED });

  pill.append(head, line, track, counts);
  root.append(pill);
  return state;
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

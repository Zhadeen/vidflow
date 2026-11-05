import type { Step } from '../runs/activity';
import { sceneNumber } from '../runs/activity';
import type { RunState } from '../runs/run';
import type { Project } from '../store/projects';
import { renderSavedBadges } from './badges';
import { findTarget, renderHighlight, tagFor } from './highlight';
import type { LiveView } from './messages';
import { placePill, pillView, renderPill } from './pill';

/**
 * What the Flow page shows for a run (background side): the pill, the ring target and the saved pictures. The step only
 * counts while this project's run is running (a paused run isn't doing anything).
 */
export function liveView(state: RunState | null, step: Step | null, project: Pick<Project, 'scenes'> | null): LiveView | null {
  const current = state && step && step.projectId === state.projectId && state.status === 'running' ? step : null;
  // The tag and badges name the scene as the studio does (its slide); the pill counts "Scene 2 of 3" within the run.
  const scene = current && project ? sceneNumber(project, current.sceneId) : null;
  const place = current && project && state ? placeInRun(project, state, current.sceneId) : null;
  const pill = pillView(state, current ? { text: current.text, scene: place } : null);
  if (!pill || !state) return null;
  const savedCards: Array<[string, number]> = [];
  for (const [sceneId, s] of Object.entries(state.sceneStates)) {
    if (s.status !== 'done' || !s.cardKeys) continue;
    const n = project ? sceneNumber(project, sceneId) : null;
    if (n !== null) for (const key of s.cardKeys) savedCards.push([key, n]);
  }
  const highlight = current?.target ? { target: current.target, ...(current.key ? { key: current.key } : {}), scene } : null;
  return { ...pill, highlight, savedCards };
}

/** A scene's place among the run's scenes (1-based, project order), or null when it isn't one of them. */
function placeInRun(project: Pick<Project, 'scenes'>, state: RunState, sceneId: string | null): number | null {
  if (!sceneId) return null;
  const i = project.scenes.filter((s) => s.id in state.sceneStates).findIndex((s) => s.id === sceneId);
  return i < 0 ? null : i + 1;
}

/**
 * Asks the background for the live view and reads the switch, then draws. Replies can arrive out of order (a refresh
 * runs on every step); only the newest refresh draws, older replies are dropped. A failed ask counts as no run.
 */
export function createRefresher(
  ask: () => Promise<LiveView | null>,
  liveSetting: () => Promise<boolean>,
  apply: (view: LiveView | null, liveOn: boolean) => void,
): () => Promise<void> {
  let latest = 0;
  return async () => {
    const mine = ++latest;
    const view = await ask().catch(() => null);
    if (mine !== latest) return;
    const liveOn = await liveSetting().catch(() => true);
    if (mine !== latest) return;
    apply(view, liveOn);
  };
}

/** Ring and badges only (cheap; call on scroll, resize and page changes). Off, or no run: both are removed. */
export function placeLive(doc: Document, view: LiveView | null, liveOn: boolean): void {
  if (!view || !liveOn) {
    renderHighlight(doc, null, null);
    renderSavedBadges(doc, new Map());
    placePill(doc); // the pill shows whatever the switch says: keep it off Flow's prompt bar on resize / page changes
    return;
  }
  const h = view.highlight;
  const target = h ? findTarget(doc, h.target, h.key) : null;
  renderHighlight(doc, target, h && target ? tagFor(h.target, h.scene) : null);
  renderSavedBadges(doc, new Map(view.savedCards));
  placePill(doc);
}

/** Draws everything VidFlow shows on the Flow page. The pill shows whenever a run is live; the rest follows the switch. */
export function renderLive(
  doc: Document,
  view: LiveView | null,
  liveOn: boolean,
  onToggle: (action: 'pause' | 'resume') => void,
): void {
  renderPill(doc, view, onToggle);
  placeLive(doc, view, liveOn);
}

import type { Scene } from '../scenes/types';
import type { AspectRatio, SceneState } from '../store/projects';
import { chosenPicture } from './choice';

const STATUS_WORD: Record<SceneState['status'], string> = {
  pending: 'Waiting',
  submitted: 'Making…',
  done: 'Ready',
  refused: 'Refused',
  failed: "Didn't work",
};

export const aspectCss = (a: AspectRatio) => a.replace(':', ' / ');

interface GridProps {
  scenes: Scene[];
  states: Record<string, SceneState>;
  urls: Record<string, string>;
  aspect: AspectRatio;
  selected: string | null;
  onSelect(sceneId: string): void;
}

/** The scene grid beside the preview: one tile per scene, filling in live. */
export function SceneGrid({ scenes, states, urls, aspect, selected, onSelect }: GridProps) {
  return (
    <ol className="vf-tiles" aria-label="Scenes">
      {scenes.map((scene, i) => {
        const state = states[scene.id];
        const picture = chosenPicture(state);
        const url = picture ? urls[picture] : undefined;
        const n = String(i + 1).padStart(2, '0');
        const word = STATUS_WORD[state?.status ?? 'pending'];
        return (
          <li key={scene.id}>
            <button
              type="button"
              className="vf-tile"
              data-status={state?.status ?? 'pending'}
              aria-current={selected === scene.id ? 'true' : undefined}
              aria-label={`Scene ${n}: ${word}`}
              onClick={() => onSelect(scene.id)}
            >
              <span className="vf-tile-frame" style={{ aspectRatio: aspectCss(aspect) }}>
                {url ? (
                  <img src={url} alt="" />
                ) : (
                  <span className={state?.status === 'submitted' ? 'vf-working' : undefined}>{word}</span>
                )}
              </span>
              <span className="vf-tile-label">
                <span>{n}</span>
                {state?.status === 'refused' || state?.status === 'failed' ? <span>{word}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

interface TimelineProps {
  scenes: Scene[];
  states: Record<string, SceneState>;
  selected: string | null;
  onSelect(sceneId: string): void;
}

/** The timeline under the editor: one segment per scene, as long as the scene. */
export function Timeline({ scenes, states, selected, onSelect }: TimelineProps) {
  return (
    <div className="vf-timeline" role="group" aria-label="Timeline">
      {scenes.map((scene, i) => {
        const length = scene.start !== null && scene.end !== null && scene.end > scene.start ? scene.end - scene.start : 4;
        const status = states[scene.id]?.status ?? 'pending';
        return (
          <button
            key={scene.id}
            type="button"
            className="vf-seg-scene"
            style={{ flexGrow: length }}
            data-status={status}
            aria-current={selected === scene.id ? 'true' : undefined}
            aria-label={`Scene ${String(i + 1).padStart(2, '0')}, ${length} seconds, ${STATUS_WORD[status]}`}
            title={`Scene ${String(i + 1).padStart(2, '0')} · ${STATUS_WORD[status]}`}
            // The scene grid is the keyboard route to each scene; the timeline stays out of the tab order.
            tabIndex={-1}
            onClick={() => onSelect(scene.id)}
          />
        );
      })}
    </div>
  );
}

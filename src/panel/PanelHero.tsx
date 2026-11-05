import { useId, useRef, useState } from 'react';
import { isHeroSheetRun, isLive, type RunState } from '../runs/run';
import type { Project } from '../store/projects';
import { Button } from '../studio/Button';
import { ModelSheet, useHeroPicture } from '../studio/HeroReference';
import type { RunClient } from '../studio/runClient';
import type { ProjectPatch } from '../studio/ScriptStep';

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  onChange(patch: ProjectPatch): void;
  /** The run as the background reported it after a request (Make model sheet). */
  onRunState(state: RunState | null): void;
}

const NO_ANSWER = "VidFlow's background didn't answer. Try again.";

/**
 * "3 · Hero" (spec §19): the description, the reference thumbnail with its status, Upload picture and Make model
 * sheet. The same behaviour as the studio's hero section (useHeroPicture, the model-sheet run and its pictures).
 */
export function PanelHero({ project, run, client, onChange, onRunState }: Props) {
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const character = project.character;
  const description = character?.description ?? '';

  /** The hero as one patch: no description and no picture means no hero (a default would bring an old one back). */
  const setHero = (text: string, referenceMediaId: string | undefined) =>
    onChange({ character: text.trim() || referenceMediaId ? { description: text, ...(referenceMediaId && { referenceMediaId }) } : null });
  const picture = useHeroPicture(project, (id) => setHero(description, id));

  // Flow is drawing this video's model sheet: the hero waits until it's done (as in the studio).
  const sheetLive = !!run && isHeroSheetRun(run) && run.projectId === project.id && (run.status === 'running' || run.status === 'paused');
  const anyLive = isLive(run);

  async function makeSheet() {
    setAsking(true);
    setSheetError(null);
    try {
      const reply = await client.heroSheet(project.id);
      if (reply.ok) onRunState(reply.state);
      else setSheetError(reply.message);
    } catch {
      setSheetError(NO_ANSWER);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="vf-pn-group">
      <span className="vf-pn-label">3 · Hero</span>
      <div className="vf-pn-hero-row">
        <span className="vf-pn-thumb" data-empty={!picture.url || undefined}>
          {picture.mediaId && picture.url && <img src={picture.url} alt="Hero reference picture" />}
          {picture.mediaId && (
            <button
              type="button"
              className="vf-pn-thumb-remove"
              aria-label="Remove picture"
              title="Remove picture"
              disabled={picture.busy || sheetLive}
              onClick={() => void picture.remove()}
            >
              ×
            </button>
          )}
        </span>
        <div className="vf-pn-hero-text">
          <input
            className="vf-pn-hero-name"
            aria-label="Hero"
            value={description}
            placeholder="Describe the hero: a short stickman with a red cap…"
            disabled={sheetLive}
            onChange={(e) => setHero(e.target.value, character?.referenceMediaId)}
          />
          <p className="vf-pn-note">{picture.mediaId ? 'Reference picture ✓ · attached to every scene' : 'No reference picture'}</p>
        </div>
      </div>
      <input
        ref={picker}
        id={`${ids}-file`}
        type="file"
        className="vf-visually-hidden"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          void picture.pick(e.target.files?.[0]).finally(() => {
            if (picker.current) picker.current.value = '';
          });
        }}
      />
      <label className="vf-visually-hidden" htmlFor={`${ids}-file`}>
        Hero reference picture file
      </label>
      <div className="vf-pn-pair">
        <Button className="vf-pn-sec" loading={picture.busy} disabled={sheetLive} onClick={() => picker.current?.click()}>
          Upload picture
        </Button>
        <Button
          className="vf-pn-sec"
          loading={asking}
          disabled={!description.trim() || anyLive || picture.busy}
          onClick={() => void makeSheet()}
        >
          Make model sheet
        </Button>
      </div>
      {(picture.error || sheetError) && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {picture.error ?? sheetError}
        </p>
      )}
      <ModelSheet
        compact
        project={project}
        controls={{ run, client, onRunState }}
        disabled={anyLive}
        busy={picture.busy}
        onUse={(pictureId) => void picture.useSheetPicture(pictureId)}
      />
    </div>
  );
}

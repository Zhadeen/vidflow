import { useId } from 'react';
import { CLIP_ASPECT_MESSAGE } from '../flow/messages';
import type { ClipLimit } from '../motion/useClipLimit';
import { estimateLine, MOTION_CHOICES } from '../motion/view';
import type { RunState } from '../runs/run';
import type { Project, SceneState } from '../store/projects';
import type { ProjectPatch } from '../studio/ScriptStep';

interface Props {
  project: Project;
  /** Each scene's state as shown (clips and pictures). */
  states: Record<string, SceneState>;
  /** The background's run: a clip run that read Flow's balance gives "credits left". */
  run: RunState | null;
  /** The credit limit field (defaults to the estimate, never above it). */
  limit: ClipLimit;
  /** The credits the clips left to make need (the limit's most). */
  needed: number;
  /** Scenes still without pictures: clips wait for them here. */
  picturesLeft: number;
  disabled?: boolean;
  onChange(patch: ProjectPatch): void;
}

/**
 * Setup's "4 · Motion" (spec §20): Stills only (default) / Clips for the slides I pick / Clips for every slide, the
 * clips · credits needed · credits left line, and the credit limit for the run. A 1:1 video can't have clips.
 */
export function MotionSection({ project, states, run, limit, needed, picturesLeft, disabled = false, onChange }: Props) {
  const ids = useId();
  const mode = project.motionMode ?? 'stills';
  const square = project.aspect === '1:1';
  const clips = mode !== 'stills' && !square;
  const whyId = `${ids}-square`;
  return (
    <div className="vf-pn-group">
      <span className="vf-pn-label">4 · Motion</span>
      <fieldset className="vf-pn-chips vf-pn-chipset-motion" role="radiogroup" aria-label="Motion" disabled={disabled}>
        {MOTION_CHOICES.map((c) => {
          const off = square && c.value !== 'stills';
          return (
            <label key={c.value} className="vf-pn-chip" data-off={off || undefined}>
              <input
                type="radio"
                name={`${ids}-motion`}
                checked={mode === c.value}
                disabled={off}
                aria-describedby={off ? whyId : undefined}
                onChange={() => onChange({ motionMode: c.value })}
              />
              <span>{c.label}</span>
            </label>
          );
        })}
      </fieldset>
      {square && (
        <p className="vf-pn-note" id={whyId}>
          {CLIP_ASPECT_MESSAGE}
        </p>
      )}
      <p className="vf-pn-note" aria-live="polite">
        {estimateLine(project, states, run)}
      </p>
      {clips && (
        <label className="vf-pn-limit">
          <span>Credit limit for this run</span>
          <input
            type="number"
            className="vf-pn-field"
            min={0}
            max={needed}
            step={1}
            inputMode="numeric"
            value={limit.text}
            disabled={disabled}
            onChange={(e) => limit.onChange(e.target.value)}
            onBlur={limit.onBlur}
          />
        </label>
      )}
      {clips && mode === 'picked' && <p className="vf-pn-note">Tick the slides that get a clip on Queue.</p>}
      {clips && picturesLeft > 0 && (
        <p className="vf-pn-note">Clips can be made once every scene has its picture — or use the studio's Motion step.</p>
      )}
    </div>
  );
}

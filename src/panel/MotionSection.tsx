import { useId } from 'react';
import { CLIP_ASPECT_MESSAGE } from '../flow/messages';
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
  /** The credits the clips left to make need (the limit's default and most). */
  needed: number;
  /** The credit limit as typed; null follows the estimate. */
  limit: string | null;
  onLimit(text: string): void;
  disabled?: boolean;
  onChange(patch: ProjectPatch): void;
}

/**
 * Setup's "4 · Motion" (spec §20): Stills only (default) / Clips for the slides I pick / Clips for every slide, the
 * clips · credits needed · credits left line, and the credit limit for the run. A 1:1 video can't have clips.
 */
export function MotionSection({ project, states, run, needed, limit, onLimit, disabled = false, onChange }: Props) {
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
            value={limit ?? String(needed)}
            disabled={disabled}
            onChange={(e) => onLimit(e.target.value)}
          />
        </label>
      )}
      {clips && mode === 'picked' && <p className="vf-pn-note">Tick the slides that get a clip on Queue.</p>}
    </div>
  );
}

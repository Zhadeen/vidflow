import { useId, useState } from 'react';
import { STYLE_PRESETS, type StyleId } from '../prompts/styles';
import type { RunState } from '../runs/run';
import type { AspectRatio, Project } from '../store/projects';
import { Button } from '../studio/Button';
import { sceneStatesFor } from '../studio/progress';
import type { ProjectPatch } from '../studio/ScriptStep';
import { useScriptDraft } from '../studio/useScriptDraft';
import type { PanelBusy } from './Panel';

const NEW = 'new';
const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1'];
const PER_SCENE = [1, 2, 4] as const;

interface FieldSelectProps {
  id?: string;
  /** Accessible name when no <label> points at it. */
  label?: string;
  /** Shown before the choice ("Style: "). */
  prefix?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}

/** A raised field reading "Style: Classic whiteboard stickman ▾"; the whole box is the (native) select. */
function FieldSelect({ id, label, prefix = '', value, options, onChange }: FieldSelectProps) {
  const shown = options.find((o) => o.value === value)?.label ?? '';
  return (
    <div className="vf-pn-field vf-pn-select">
      <span aria-hidden="true">
        {prefix}
        {shown} ▾
      </span>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface PickerProps {
  projects: Pick<Project, 'id' | 'name'>[];
  value: string | null;
  onPick(id: string): void;
  onCreate(name: string): Promise<void>;
}

/** "Video": the videos in VidFlow, newest first, and "+ New video…". */
export function VideoPicker({ projects, value, onPick, onCreate }: PickerProps) {
  const ids = useId();
  const [creating, setCreating] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [making, setMaking] = useState(false);

  async function make() {
    if (!name.trim() || making) return;
    setMaking(true);
    try {
      await onCreate(name.trim());
      setCreating(false);
      setName('');
    } finally {
      setMaking(false);
    }
  }

  return (
    <div className="vf-pn-group">
      <label className="vf-pn-label" htmlFor={`${ids}-video`}>
        Video
      </label>
      <FieldSelect
        id={`${ids}-video`}
        value={creating ? NEW : (value ?? NEW)}
        options={[...projects.map((p) => ({ value: p.id, label: p.name })), { value: NEW, label: '+ New video…' }]}
        onChange={(v) => {
          if (v === NEW) setCreating(true);
          else {
            setCreating(false);
            onPick(v);
          }
        }}
      />
      {creating && (
        <form
          className="vf-pn-new"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <input
            className="vf-pn-field"
            aria-label="Name of the new video"
            placeholder="Name of the new video"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" small disabled={!name.trim()} loading={making}>
            Make video
          </Button>
        </form>
      )}
    </div>
  );
}

interface Props {
  project: Project;
  run: RunState | null;
  busy: PanelBusy;
  error: string | null;
  onChange(patch: ProjectPatch): void;
  onStart(): void;
  /** Every scene has its pictures: review them in the full studio. */
  onReview(): void;
}

/** Before starting: paste Claude's reply, choose the look, start. */
export function PanelSetup({ project, run, busy, error, onChange, onStart, onReview }: Props) {
  const ids = useId();
  const draft = useScriptDraft(project, (scenes) => onChange({ scenes }));
  const states = sceneStatesFor(project, run);
  const remaining = project.scenes.filter((s) => states[s.id].status !== 'done' && states[s.id].status !== 'refused').length;
  const pictures = remaining * project.outputsPerPrompt;
  const sceneCount = project.scenes.length;
  const preview = draft.preview;

  return (
    <>
      <div className="vf-pn-group">
        <label className="vf-pn-label" htmlFor={`${ids}-reply`}>
          1 · Paste Claude's reply
        </label>
        <textarea
          id={`${ids}-reply`}
          aria-label="Paste Claude's reply"
          className="vf-pn-field vf-pn-paste"
          value={draft.text}
          placeholder={
            sceneCount > 0
              ? `${sceneCount} ${sceneCount === 1 ? 'scene is' : 'scenes are'} loaded. Paste a new reply to replace ${sceneCount === 1 ? 'it' : 'them'}.`
              : 'Slide,Timecode,Sentence,Concept…'
          }
          onChange={(e) => draft.setText(e.target.value)}
        />
        <div aria-live="polite">
          {preview ? (
            preview.scenes.length === 0 ? (
              <p className="vf-pn-found">VidFlow found no scenes. Check you pasted Claude's whole reply.</p>
            ) : (
              <>
                <p className="vf-pn-found">
                  ✓ {preview.scenes.length} {preview.scenes.length === 1 ? 'scene' : 'scenes'} found ·{' '}
                  {preview.issues.length === 0 ? 'no problems' : `${preview.issues.length} to check`}
                </p>
                {preview.issues.length > 0 && (
                  <ul className="vf-pn-issues">
                    {preview.issues.map((issue, i) => (
                      <li key={i}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </>
            )
          ) : (
            sceneCount > 0 && (
              <p className="vf-pn-found">
                ✓ {sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'} in this video
              </p>
            )
          )}
        </div>
      </div>

      <div className="vf-pn-group">
        <span className="vf-pn-label" id={`${ids}-choose`}>
          2 · Choose
        </span>
        <div className="vf-pn-chips">
          <fieldset className="vf-pn-chipset">
            <legend className="vf-visually-hidden">Shape</legend>
            {ASPECTS.map((a) => (
              <label key={a} className="vf-pn-chip">
                <input type="radio" name={`${ids}-aspect`} checked={project.aspect === a} onChange={() => onChange({ aspect: a })} />
                <span>{a}</span>
              </label>
            ))}
          </fieldset>
          <select
            className="vf-pn-chip-select"
            aria-label="Pictures per scene"
            value={String(project.outputsPerPrompt)}
            onChange={(e) => onChange({ outputsPerPrompt: Number(e.target.value) as 1 | 2 | 4 })}
          >
            {PER_SCENE.map((n) => (
              <option key={n} value={n}>
                {n} per scene
              </option>
            ))}
          </select>
        </div>
        <FieldSelect
          label="Style"
          prefix="Style: "
          value={project.style}
          options={[
            ...(Object.keys(STYLE_PRESETS) as Exclude<StyleId, 'custom'>[]).map((id) => ({ value: id, label: STYLE_PRESETS[id].name })),
            { value: 'custom', label: 'Your own style' },
          ]}
          onChange={(v) => onChange({ style: v as StyleId })}
        />
        {project.style === 'custom' && (
          <textarea
            className="vf-pn-field vf-pn-custom"
            aria-label="Your own style"
            rows={2}
            value={project.customStyle ?? ''}
            placeholder="Simple stick figures in blue ballpoint on lined paper…"
            onChange={(e) => onChange({ customStyle: e.target.value })}
          />
        )}
        <label className="vf-pn-field vf-pn-hero">
          <span aria-hidden="true">Hero:</span>
          <input
            aria-label="Hero"
            value={project.character?.description ?? ''}
            placeholder="a short stickman with a red cap…"
            onChange={(e) =>
              onChange({ character: e.target.value.trim() ? { description: e.target.value, hasReferenceImage: false } : null })
            }
          />
        </label>
      </div>

      <p className="vf-pn-summary">
        {sceneCount === 0
          ? "Paste Claude's reply to start."
          : remaining === 0
            ? `All ${sceneCount} ${sceneCount === 1 ? 'scene has' : 'scenes have'} pictures.`
            : `${pictures} ${pictures === 1 ? 'picture' : 'pictures'} · 0 Flow credits · Chrome shows a “debugging” bar while it runs`}
      </p>

      {draft.needsConfirm && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {sceneCount === 1
            ? 'This replaces 1 scene and its pictures. Continue?'
            : `This replaces ${sceneCount} scenes and their pictures. Continue?`}
        </p>
      )}
      {error && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {error}
        </p>
      )}

      <div className="vf-pn-actions">
        {draft.needsConfirm ? (
          <>
            <Button variant="primary" onClick={draft.confirm}>
              Yes, replace them
            </Button>
            <Button onClick={draft.cancel}>Keep the old scenes</Button>
          </>
        ) : draft.pending ? (
          <Button variant="primary" onClick={draft.apply}>
            Use these scenes
          </Button>
        ) : sceneCount > 0 && remaining === 0 ? (
          <Button variant="primary" onClick={onReview}>
            Review in the full studio
          </Button>
        ) : (
          <Button variant="primary" onClick={onStart} loading={busy === 'start'} disabled={sceneCount === 0}>
            Start making pictures
          </Button>
        )}
      </div>
    </>
  );
}

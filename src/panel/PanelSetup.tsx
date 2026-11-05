import { useEffect, useId, useRef, useState } from 'react';
import { buildClaudePrompt, buildRapidBeatPrompt } from '../prompts/claude';
import { STYLE_PRESETS, type StyleId } from '../prompts/styles';
import { isHeroSheetRun, type RunState } from '../runs/run';
import { fileToText, SCENE_FILE_ACCEPT } from '../scenes/fileText';
import type { AspectRatio, Project } from '../store/projects';
import { Button } from '../studio/Button';
import { sceneStatesFor } from '../studio/progress';
import type { RunClient } from '../studio/runClient';
import type { ProjectPatch } from '../studio/ScriptStep';
import { useScriptDraft } from '../studio/useScriptDraft';
import type { PanelBusy } from './Panel';
import { PanelHero } from './PanelHero';

const NEW = 'new';
const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1'];
const PER_SCENE = [1, 2, 4] as const;

interface FieldSelectProps {
  id?: string;
  /** Accessible name when no <label> points at it. */
  label?: string;
  /** Shown before the choice ("Style: "). */
  prefix?: string;
  /** A quiet note after the choice ("+ New"). */
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange(value: string): void;
}

/** A raised field reading "Style: Classic whiteboard stickman ▾"; the whole box is the (native) select. */
export function FieldSelect({ id, label, prefix = '', hint, value, options, disabled, onChange }: FieldSelectProps) {
  const shown = options.find((o) => o.value === value)?.label ?? '';
  return (
    <div className="vf-pn-field vf-pn-select">
      <span aria-hidden="true">
        {prefix}
        {shown} ▾{hint && <span className="vf-pn-field-hint">{hint}</span>}
      </span>
      <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
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
        hint="+ New"
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

/** About 20 s a scene (measured: ~2 min for 6), never less than a minute (spec §19, detail 5). */
export const minutesFor = (scenes: number) => Math.max(1, Math.round((scenes * 20) / 60));

const COPY_FAILED = "VidFlow couldn't copy the prompt. Try again.";

/** "1 · Get your scenes": the two prompts copied with the video's saved script (no script box in the panel). */
function CopyPrompts({ script, onOpenStudio }: { script: string; onOpenStudio(): void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(text: string) {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  if (!script.trim()) {
    return (
      <p className="vf-pn-note">
        Add your script in the full studio first{' '}
        <button type="button" className="vf-pn-inline" onClick={onOpenStudio}>
          Open full studio
        </button>
      </p>
    );
  }
  return (
    <>
      <div className="vf-pn-pair">
        <Button className="vf-pn-sec" onClick={() => void copy(buildClaudePrompt(script))}>
          Copy Claude prompt
        </Button>
        <Button className="vf-pn-sec" aria-label="Copy rapid-beat prompt" onClick={() => void copy(buildRapidBeatPrompt(script))}>
          Copy rapid-beat
        </Button>
      </div>
      <p className="vf-pn-note" role="status" hidden={!copied && !failed}>
        {copied ? 'Copied' : failed ? COPY_FAILED : ''}
      </p>
    </>
  );
}

interface Props {
  project: Project;
  run: RunState | null;
  client: RunClient;
  busy: PanelBusy;
  error: string | null;
  onChange(patch: ProjectPatch): void;
  onRunState(state: RunState | null): void;
  onStart(): void;
  /** Every scene has its pictures: review them in the full studio. */
  onReview(): void;
  onOpenStudio(): void;
  /** A run of this video's scenes is going or paused: scenes, look and hero wait (as the studio's locked). */
  locked?: boolean;
  /** "Go to Queue", the coral action while locked. */
  onGoToQueue(): void;
}

/** The Setup tab (spec §19): get the scenes, choose the look, the hero, start. */
export function PanelSetup({
  project,
  run,
  client,
  busy,
  error,
  onChange,
  onRunState,
  onStart,
  onReview,
  onOpenStudio,
  locked = false,
  onGoToQueue,
}: Props) {
  const ids = useId();
  const draft = useScriptDraft(project, (scenes) => onChange({ scenes }));
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const states = sceneStatesFor(project, run);
  const remaining = project.scenes.filter((s) => states[s.id].status !== 'done' && states[s.id].status !== 'refused').length;
  const pictures = remaining * project.outputsPerPrompt;
  const sceneCount = project.scenes.length;
  const preview = draft.preview;
  // Flow is drawing this video's model sheet: the look and Start wait until it's done (as in the studio).
  const sheetLive = !!run && isHeroSheetRun(run) && run.projectId === project.id && (run.status === 'running' || run.status === 'paused');
  const lookFrozen = locked || sheetLive;

  async function upload(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const result = await fileToText(file);
      if (result.ok) draft.setText(result.text);
      else setFileError(result.message);
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const uploadLink = (
    <button type="button" className="vf-pn-inline" disabled={reading || locked} onClick={() => fileInput.current?.click()}>
      upload a CSV / TXT / PDF
    </button>
  );

  return (
    <>
      {locked && (
        <p className="vf-pn-sub" role="status">
          VidFlow is making pictures for this video. Its scenes and look wait until it stops.
        </p>
      )}
      <div className="vf-pn-group">
        <span className="vf-pn-label">1 · Get your scenes</span>
        <CopyPrompts script={project.script ?? ''} onOpenStudio={onOpenStudio} />
        <div className="vf-pn-field vf-pn-pastebox">
          <textarea
            id={`${ids}-reply`}
            aria-label="Paste Claude's reply"
            className="vf-pn-paste"
            value={draft.text}
            disabled={locked}
            onChange={(e) => draft.setText(e.target.value)}
          />
          {!draft.text && (
            <p className="vf-pn-paste-hint">
              {sceneCount > 0
                ? `${sceneCount} ${sceneCount === 1 ? 'scene is' : 'scenes are'} loaded. Paste a new reply to replace ${sceneCount === 1 ? 'it' : 'them'}… or `
                : "Paste Claude's reply here… or "}
              {uploadLink}
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            className="vf-visually-hidden"
            aria-label="Upload a scene file"
            accept={SCENE_FILE_ACCEPT}
            disabled={locked}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>
        {/* With text in the box the link moves below it: a new file replaces the text. */}
        {draft.text && <p className="vf-pn-note">Or {uploadLink} instead</p>}
        {fileError && (
          <p className="vf-notice vf-pn-notice" role="alert">
            {fileError}
          </p>
        )}
        <div aria-live="polite">
          {preview ? (
            preview.scenes.length === 0 ? (
              <p className="vf-pn-found">VidFlow found no scenes. Check you pasted Claude's whole reply.</p>
            ) : (
              <>
                <p className="vf-pn-found">
                  <span>
                    ✓ {preview.scenes.length} {preview.scenes.length === 1 ? 'scene' : 'scenes'} found ·{' '}
                    {preview.issues.length === 0 ? 'no problems' : `${preview.issues.length} to check`}
                  </span>
                  {draft.pending && !draft.needsConfirm && !locked && (
                    <button type="button" className="vf-pn-inline" onClick={draft.apply}>
                      Use these scenes
                    </button>
                  )}
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
        <span className="vf-pn-label">2 · Look</span>
        <div className="vf-pn-chips">
          <fieldset className="vf-pn-chipset" disabled={lookFrozen}>
            <legend className="vf-visually-hidden">Shape</legend>
            {ASPECTS.map((a) => (
              <label key={a} className="vf-pn-chip">
                <input type="radio" name={`${ids}-aspect`} checked={project.aspect === a} onChange={() => onChange({ aspect: a })} />
                <span>{a}</span>
              </label>
            ))}
          </fieldset>
          {/* As in the approved panel: the chosen count reads "2 per scene", the others just "1" and "4". */}
          <fieldset className="vf-pn-chipset" disabled={lookFrozen}>
            <legend className="vf-visually-hidden">Pictures per scene</legend>
            {PER_SCENE.map((n) => (
              <label key={n} className="vf-pn-chip">
                <input
                  type="radio"
                  name={`${ids}-per-scene`}
                  aria-label={`${n} per scene`}
                  checked={project.outputsPerPrompt === n}
                  onChange={() => onChange({ outputsPerPrompt: n })}
                />
                <span>{project.outputsPerPrompt === n ? `${n} per scene` : n}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <FieldSelect
          label="Style"
          prefix="Style: "
          value={project.style}
          options={[
            ...(Object.keys(STYLE_PRESETS) as Exclude<StyleId, 'custom'>[]).map((id) => ({ value: id, label: STYLE_PRESETS[id].name })),
            { value: 'custom', label: 'Your own style' },
          ]}
          disabled={lookFrozen}
          onChange={(v) => onChange({ style: v as StyleId })}
        />
        {project.style === 'custom' && (
          <textarea
            className="vf-pn-field vf-pn-custom"
            aria-label="Your own style"
            rows={2}
            value={project.customStyle ?? ''}
            disabled={lookFrozen}
            placeholder="Simple stick figures in blue ballpoint on lined paper…"
            onChange={(e) => onChange({ customStyle: e.target.value })}
          />
        )}
      </div>

      <PanelHero project={project} run={run} client={client} onChange={onChange} onRunState={onRunState} locked={locked} />

      <p className="vf-pn-summary">
        {sceneCount === 0
          ? "Paste Claude's reply to start."
          : remaining === 0
            ? `All ${sceneCount} ${sceneCount === 1 ? 'scene has' : 'scenes have'} pictures.`
            : `${pictures} ${pictures === 1 ? 'picture' : 'pictures'} · 0 Flow credits · ~${minutesFor(remaining)} min`}
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

      <div className="vf-pn-actions vf-pn-end">
        {locked ? (
          <Button variant="primary" onClick={onGoToQueue}>
            Go to Queue
          </Button>
        ) : draft.needsConfirm ? (
          <>
            <Button variant="primary" onClick={draft.confirm}>
              Yes, replace them
            </Button>
            <Button onClick={draft.cancel}>Keep the old scenes</Button>
          </>
        ) : sceneCount > 0 && remaining === 0 && !draft.pending ? (
          <Button variant="primary" onClick={onReview}>
            Review in the full studio
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={onStart}
            loading={busy === 'start'}
            disabled={sceneCount === 0 || !!draft.pending || sheetLive}
          >
            Start making pictures
          </Button>
        )}
      </div>
    </>
  );
}

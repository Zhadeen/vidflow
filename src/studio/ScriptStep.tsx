import { useId, useState, type DragEvent } from 'react';
import type { CharacterSpec } from '../prompts/build';
import { buildClaudePrompt } from '../prompts/claude';
import { STYLE_PRESETS, type StyleId } from '../prompts/styles';
import { parseSceneFile } from '../scenes/parse';
import type { ParseIssue, Scene } from '../scenes/types';
import type { AspectRatio, Project } from '../store/projects';
import { Button } from './Button';

export type ProjectPatch = Partial<Pick<Project, 'script' | 'scenes' | 'style' | 'customStyle' | 'character' | 'aspect' | 'outputsPerPrompt'>>;

interface Props {
  project: Project;
  /** A run for this project is going or paused: the scenes and the look can't change. */
  locked: boolean;
  /** True when some scenes already have pictures (a new scene file starts them again). */
  hasPictures: boolean;
  onChange(patch: ProjectPatch): void;
  onContinue(): void;
}

const STYLE_NOTES: Record<Exclude<StyleId, 'custom'>, string> = {
  'stickman-whiteboard': 'Black marker on a white board.',
  'stickman-doodle-comic': 'Wobbly pen doodles on cream paper.',
  'stickman-colour': 'Thin outlines with flat colour fills.',
};

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
];

type CopyState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'failed' };

export function ScriptStep({ project, locked, hasPictures, onChange, onContinue }: Props) {
  const ids = useId();
  const [script, setScript] = useState(project.script ?? '');
  const [reply, setReply] = useState('');
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [readCount, setReadCount] = useState<number | null>(null);
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  /** Scenes read from the reply but not used yet (they replace the project's only on "Use these scenes"). */
  const [pending, setPending] = useState<Scene[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  function readReply(text: string) {
    setReply(text);
    setConfirming(false);
    if (!text.trim()) {
      setIssues([]);
      setReadCount(null);
      setPending(null);
      return;
    }
    const { scenes, issues: found } = parseSceneFile(text);
    setIssues(found);
    setReadCount(scenes.length);
    setPending(scenes.length > 0 ? scenes : null);
  }

  function useScenes() {
    if (!pending) return;
    if (hasPictures && project.scenes.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onChange({ scenes: pending });
    setPending(null);
    setConfirming(false);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildClaudePrompt(script));
      setCopy({ kind: 'copied' });
    } catch {
      setCopy({ kind: 'failed' });
    }
  }

  async function readFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    try {
      readReply(await file.text());
    } catch {
      setFileError(`VidFlow couldn't read ${file.name}. Open it, copy everything, and paste it into the box instead.`);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!locked) void readFile(e.dataTransfer.files[0]);
  }

  const character = project.character;
  const setHero = (description: string) =>
    onChange({ character: description.trim() ? { description, hasReferenceImage: false } satisfies CharacterSpec : null });

  const sceneCount = project.scenes.length;
  const listed = pending ?? project.scenes;

  return (
    <div className="vf-stack">
      <div className="vf-script-grid">
        <div className="vf-stack">
          <section className="vf-panel">
            <h2 className="vf-h2" id={`${ids}-script`}>
              Your script
            </h2>
            <p className="vf-hint">Paste the words of your video. Claude turns them into scenes.</p>
            <label className="vf-visually-hidden" htmlFor={`${ids}-script-box`}>
              Your script
            </label>
            <textarea
              id={`${ids}-script-box`}
              className="vf-input"
              rows={7}
              value={script}
              placeholder="I opened my phone bill and nearly fell off my chair…"
              onChange={(e) => {
                setScript(e.target.value);
                setCopy({ kind: 'idle' });
                onChange({ script: e.target.value });
              }}
            />
            <div className="vf-row" style={{ marginTop: 'var(--vf-space-3)' }}>
              <Button onClick={() => void copyPrompt()} disabled={!script.trim()}>
                Copy Claude Prompt
              </Button>
              <p className="vf-hint" style={{ margin: 0 }} aria-live="polite">
                {copy.kind === 'copied'
                  ? "Copied. Now paste it into claude.ai, then paste Claude's reply in the box below."
                  : copy.kind === 'failed'
                    ? "Chrome didn't let VidFlow copy. Click anywhere on this page, then press Copy Claude Prompt again."
                    : !script.trim()
                      ? 'Paste your script first.'
                      : 'Copies the instructions and your script, ready for claude.ai.'}
              </p>
            </div>
          </section>

          <section className="vf-panel">
            <h2 className="vf-h2" id={`${ids}-reply`}>
              Claude's reply
            </h2>
            <p className="vf-hint">
              Paste Claude's whole reply here, or drop the scene file on this box.{' '}
              {!locked && (
                <label className="vf-file-label">
                  Choose a file
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    className="vf-visually-hidden"
                    onChange={(e) => void readFile(e.target.files?.[0])}
                  />
                </label>
              )}
            </p>
            <div
              className="vf-drop"
              data-over={over}
              onDragOver={(e) => {
                e.preventDefault();
                if (!locked) setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <label className="vf-visually-hidden" htmlFor={`${ids}-reply-box`}>
                Claude's reply
              </label>
              <textarea
                id={`${ids}-reply-box`}
                className="vf-input vf-mono"
                rows={8}
                value={reply}
                disabled={locked}
                placeholder={sceneCount > 0 ? `${sceneCount} ${sceneCount === 1 ? 'scene is' : 'scenes are'} loaded. Paste a new reply to replace ${sceneCount === 1 ? 'it' : 'them'}.` : 'Slide,Timecode,Sentence,…'}
                onChange={(e) => readReply(e.target.value)}
              />
            </div>
            {fileError && (
              <p className="vf-notice" role="alert" style={{ marginTop: 'var(--vf-space-3)' }}>
                {fileError}
              </p>
            )}
            {hasPictures && !locked && (
              <p className="vf-hint" style={{ marginTop: 'var(--vf-space-3)', marginBottom: 0 }}>
                This video already has pictures. Using a new reply replaces the scenes, and their pictures are made again.
              </p>
            )}
            {readCount !== null && (
              <div style={{ marginTop: 'var(--vf-space-3)' }} aria-live="polite">
                <p className="vf-status">
                  {readCount === 0
                    ? "VidFlow found no scenes in this reply. Check you pasted Claude's whole reply."
                    : `VidFlow read ${readCount} ${readCount === 1 ? 'scene' : 'scenes'}${pending ? '. Press Use these scenes to use them' : ' and is using them'}.`}
                  {issues.length > 0 && readCount > 0 && ' Some need a look, but you can carry on:'}
                </p>
                {issues.length > 0 && (
                  <ul className="vf-issues">
                    {issues.map((issue, i) => (
                      <li key={i}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {listed.length > 0 && (
            <section className="vf-panel" aria-labelledby={`${ids}-scenes`}>
              <h2 className="vf-h2" id={`${ids}-scenes`}>
                {listed.length} {listed.length === 1 ? 'scene' : 'scenes'}
                {pending ? ' in this reply (not used yet)' : ''}
              </h2>
              <ol className="vf-scene-list">
                {listed.map((scene, i) => (
                  <li key={scene.id}>
                    <span className="vf-num">{String(i + 1).padStart(2, '0')}</span>
                    <span>{scene.sentence || scene.imagePrompt || 'No words or picture prompt.'}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <section className="vf-panel vf-stack" aria-labelledby={`${ids}-look`}>
          <div>
            <h2 className="vf-h2" id={`${ids}-look`}>
              The look
            </h2>
            <p className="vf-hint" style={{ marginBottom: 0 }}>
              {locked
                ? 'VidFlow is making pictures for this video. Pause it on the Pictures step to change the scenes or the look.'
                : 'VidFlow adds this to every picture prompt, so all scenes match.'}
            </p>
          </div>

          <fieldset className="vf-choices" disabled={locked}>
            <legend>Style</legend>
            {(Object.keys(STYLE_PRESETS) as Exclude<StyleId, 'custom'>[]).map((id) => (
              <label key={id} className="vf-choice">
                <input type="radio" name={`${ids}-style`} checked={project.style === id} onChange={() => onChange({ style: id })} />
                <span className="vf-choice-text">
                  <span>{STYLE_PRESETS[id].name}</span>
                  <span className="vf-choice-sub">{STYLE_NOTES[id]}</span>
                </span>
              </label>
            ))}
            <label className="vf-choice">
              <input type="radio" name={`${ids}-style`} checked={project.style === 'custom'} onChange={() => onChange({ style: 'custom' })} />
              <span className="vf-choice-text">
                <span>Your own style</span>
                <span className="vf-choice-sub">Describe the look in your own words.</span>
              </span>
            </label>
            {project.style === 'custom' && (
              <>
                <label className="vf-visually-hidden" htmlFor={`${ids}-custom`}>
                  Your own style
                </label>
                <textarea
                  id={`${ids}-custom`}
                  className="vf-input"
                  rows={3}
                  value={project.customStyle ?? ''}
                  placeholder="Simple stick figures in blue ballpoint on lined paper…"
                  onChange={(e) => onChange({ customStyle: e.target.value })}
                />
              </>
            )}
          </fieldset>

          <div>
            <label className="vf-label" htmlFor={`${ids}-hero`}>
              The hero <span className="vf-choice-sub">(optional)</span>
            </label>
            <textarea
              id={`${ids}-hero`}
              className="vf-input"
              rows={3}
              disabled={locked}
              value={character?.description ?? ''}
              placeholder="A tall stick figure with a round head, messy hair and a red scarf."
              onChange={(e) => setHero(e.target.value)}
            />
            <p className="vf-hint" style={{ margin: 'var(--vf-space-2) 0 0' }}>
              Kept the same in every scene.
            </p>
          </div>

          <Segmented
            legend="Shape"
            name={`${ids}-aspect`}
            disabled={locked}
            value={project.aspect}
            options={ASPECTS}
            onChange={(aspect) => onChange({ aspect })}
          />

          <div>
            <Segmented
              legend="Pictures per scene"
              name={`${ids}-outputs`}
              disabled={locked}
              value={String(project.outputsPerPrompt)}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '4', label: '4' },
              ]}
              onChange={(v) => onChange({ outputsPerPrompt: Number(v) as 1 | 2 | 4 })}
            />
            <p className="vf-hint" style={{ margin: 'var(--vf-space-2) 0 0' }}>
              Two gives you a choice for each scene. Pictures cost no Flow credits.
            </p>
          </div>
        </section>
      </div>

      {confirming && (
        <p className="vf-notice" role="alert">
          {sceneCount === 1
            ? 'This replaces 1 scene and its pictures. Continue?'
            : `This replaces ${sceneCount} scenes and their pictures. Continue?`}
        </p>
      )}
      <div className="vf-actions">
        {confirming ? (
          <>
            <Button variant="primary" onClick={useScenes}>
              Yes, replace them
            </Button>
            <Button onClick={() => setConfirming(false)}>Keep the old scenes</Button>
          </>
        ) : pending ? (
          <Button variant="primary" onClick={useScenes} disabled={locked}>
            Use these scenes
          </Button>
        ) : (
          <Button variant="primary" onClick={onContinue} disabled={sceneCount === 0}>
            Continue to Pictures →
          </Button>
        )}
      </div>
      {!pending && sceneCount === 0 && <p className="vf-hint">Paste Claude's reply to continue.</p>}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange(value: T): void;
}

function Segmented<T extends string>({ legend, name, value, options, disabled, onChange }: SegmentedProps<T>) {
  return (
    <fieldset className="vf-seg" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="vf-seg-options">
        {options.map((o) => (
          <label key={o.value} className="vf-seg-option">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

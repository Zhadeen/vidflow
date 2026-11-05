import { useState } from 'react';
import { parseSceneFile } from '../scenes/parse';
import type { ParseResult, Scene } from '../scenes/types';
import type { Project } from '../store/projects';

export interface ScriptDraft {
  /** The pasted reply as typed. */
  text: string;
  setText(t: string): void;
  /** What the reply holds, or null when the box is empty. Stays after the scenes are used. */
  preview: ParseResult | null;
  /** Scenes read but not used yet: nothing changes until apply() (and confirm(), when it asks). */
  pending: Scene[] | null;
  /** Using them would replace scenes that already have pictures: ask first. */
  needsConfirm: boolean;
  apply(): void;
  confirm(): void;
  cancel(): void;
}

/**
 * A pasted Claude reply, previewed: the project's scenes change only on "Use these scenes" (apply), and when that would
 * replace scenes with pictures, only after the owner says yes (confirm). Shared by the studio and the side panel.
 */
export function useScriptDraft(project: Project, onApply: (scenes: Scene[]) => void): ScriptDraft {
  const [text, setTextState] = useState('');
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [pending, setPending] = useState<Scene[] | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  function setText(t: string) {
    setTextState(t);
    setNeedsConfirm(false);
    if (!t.trim()) {
      setPreview(null);
      setPending(null);
      return;
    }
    const result = parseSceneFile(t);
    setPreview(result);
    setPending(result.scenes.length > 0 ? result.scenes : null);
  }

  function use() {
    if (!pending) return;
    onApply(pending);
    setPending(null);
    setNeedsConfirm(false);
  }

  const hasPictures = project.scenes.some((s) => project.sceneStates[s.id]?.status === 'done');

  return {
    text,
    setText,
    preview,
    pending,
    needsConfirm,
    apply() {
      if (!pending) return;
      if (hasPictures && project.scenes.length > 0 && !needsConfirm) {
        setNeedsConfirm(true);
        return;
      }
      use();
    },
    confirm: use,
    cancel: () => setNeedsConfirm(false),
  };
}

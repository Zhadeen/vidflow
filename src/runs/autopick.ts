import type { Project, SceneState } from '../store/projects';
import { choiceSourceOf } from '../studio/chosen';

/**
 * Auto-pick with Flow's Agent (spec §20, spike S6): the pure parts. The run itself (uploads, the question, the reply)
 * is the coordinator's 'auto-pick' run kind; startAutoPick lives there with the other starts.
 */

/** At most this many of a slide's pictures are attached to one question (named -a … -d). */
export const AUTO_PICK_MAX_PICTURES = 4;

/** How long the Agent may take to answer one slide's question (spec §20). */
export const AUTO_PICK_REPLY_MS = 90_000;

/** This many slides in a row without a usable answer stop the pass (spec §20). */
export const AUTO_PICK_MAX_MISSES = 3;

/** A slide's reason when the Agent gave no usable answer: its picture stays as it is. */
export const NOT_AUTO_CHECKED = 'not auto-checked';

/** Said when the pass stops after three unanswered slides in a row (the run finishes; it isn't paused). */
export const AUTO_PICK_GAVE_UP_MESSAGE =
  "Flow's Agent didn't answer three times in a row. Your pictures are unchanged from here on.";

/** Said when "Auto-pick now" finds nothing to ask about. */
export const NOTHING_TO_AUTO_PICK_MESSAGE = 'No slide needs auto-picking: each has one picture, your own choice, or was checked already.';

const ORDINAL = ['first', 'second', 'third', 'fourth'];

/** The S6 question: "1 or 2" for two pictures, "one number from 1 to N" for more. */
export const AUTO_PICK_QUESTION = (prompt: string, count: number): string => {
  const scene = prompt.trim();
  if (count <= 2) {
    return `Text answer only, don't create anything. Image 1 is the first attachment, image 2 the second. Which better matches this scene: "${scene}"? Answer with just 1 or 2, then a short reason.`;
  }
  const order = Array.from({ length: count }, (_, i) => `image ${i + 1} the ${ORDINAL[i] ?? `${i + 1}th`}`).join(', ');
  return `Text answer only, don't create anything. Image 1 to image ${count} are the attachments in the order attached: ${order}. Which best matches this scene: "${scene}"? Answer with just one number from 1 to ${count}, then a short reason.`;
};

/** How long a kept reason may be. */
const REASON_MAX = 140;

/**
 * The Agent's reply → which attached picture it chose. Accepted only when the first non-space token is a single digit
 * 1..count, optionally followed by punctuation (". ) — – - : , ;"), and nothing after it names another number as an
 * alternative ("1 or 2", "1-2", "1, 2"). The reason is the rest, trimmed, at most 140 characters. Anything else → null.
 */
export function parseAgentAnswer(text: string, count: number): { pick: number; reason: string } | null {
  const m = /^\s*([1-9])(?![0-9A-Za-z])([.):;,!—–-]*)(.*)$/s.exec(text);
  if (!m) return null;
  const pick = Number(m[1]);
  if (pick < 1 || pick > count) return null;
  const rest = m[3]!.trim();
  // "1 or 2", "1 and 2", "1/2", "1, 2", "1-2": not one answer.
  if (/^\d/.test(rest) || /^(or|and|to|&|\/)\s*\d/i.test(rest)) return null;
  const reason = rest.replace(/^[\s.):;,!—–-]+/, '').trim();
  return { pick, reason: reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 1).trimEnd()}…` : reason };
}

/** A comparison picture's asset name in Flow: vidflow-s<NN>-a.png … -d.png, NN the slide's place in the video. */
export function comparisonName(project: Pick<Project, 'scenes'>, sceneId: string, index: number): string {
  const i = project.scenes.findIndex((s) => s.id === sceneId);
  return `vidflow-s${String(i + 1).padStart(2, '0')}-${'abcd'[index] ?? 'x'}.png`;
}

/** A tile captioned with a comparison upload's name: never a picture or a clip. */
export const isComparisonUpload = (caption: string): boolean => /\bvidflow-s\d+-[a-z]\.png\b/i.test(caption);

/** Slides Auto-pick asks about, in slide order: 2+ pictures, no choice of the owner's, not checked already. */
export function autoPickSlides(project: Project): string[] {
  return project.scenes
    .filter((s) => eligible(project.sceneStates[s.id]))
    .map((s) => s.id);
}

function eligible(state: SceneState | undefined): boolean {
  return !!state && state.status === 'done' && state.pictureIds.length >= 2 && choiceSourceOf(state) !== 'owner' && state.autoChecked !== true;
}

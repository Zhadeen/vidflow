import type { FlowResultCard } from './driver';

/**
 * Matching Flow's result tiles to scenes (spike S5, "Matching results to prompts").
 *
 * Flow renames a finished tile to a short AI title, so finished captions are never used. Instead: VidFlow works in a
 * fresh Flow project per run, Flow lists tiles newest-submission first, and each submission's outputs sit together.
 * Read oldest first, the new tiles fill the submissions in `seq` order. Every picture is then checked against the full
 * prompt in its detail view (`verifyMatch`) before it is saved; a checked prompt (`detailPrompts`) overrides position.
 */
export interface Submission {
  sceneId: string;
  prompt: string;
  submittedAt: number;
  seq: number;
}

export type Match =
  /** The scene's outputs are all in. Each key must pass verification before its picture is saved. */
  | { kind: 'pictures'; sceneId: string; cardKeys: string[] }
  | { kind: 'refused'; sceneId: string; cardKeys: []; message: string }
  /** A later scene's verified picture sits where this scene's must be: no consistent assignment exists. */
  | { kind: 'unconfirmed'; sceneId: string; cardKeys: [] };

/** The outcome of checking one card against a scene's submitted prompt in Flow's detail view. */
export interface Verification {
  sceneId: string;
  cardKey: string;
  /** The full prompt the detail view showed; null when VidFlow couldn't read it. */
  detailPrompt: string | null;
  ok: boolean;
}

export const UNCONFIRMED_MESSAGE = "VidFlow couldn't confirm which picture belongs to this scene. Press Try again.";

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** True when the detail view's prompt is the submitted prompt (whitespace and case aside). */
export function verifyMatch(submittedPrompt: string, detailPrompt: string): boolean {
  const a = normalise(submittedPrompt);
  return a !== '' && a === normalise(detailPrompt);
}

const isFinished = (c: FlowResultCard) => c.imageUrl !== null && c.progress === null && !c.key.startsWith('pending-');

interface Slot {
  sub: Submission;
  keys: string[];
  filled: number;
  refusal: string | null;
  /** Extra refused tiles of the same submission still to absorb (Flow may show one per output). */
  absorb: number;
  unconfirmed: boolean;
}

/**
 * Complete matches only: a scene appears once all `outputsPerPrompt` of its tiles are finished, or Flow refused it.
 * Cards in `seenCardKeys` (before the run, or already saved for a scene) are never assigned. Cards that fit no scene
 * (surplus batches, foreign tiles) stay unassigned rather than shifting onto later scenes.
 */
export function matchResults(
  submissions: Submission[],
  cards: FlowResultCard[],
  seenCardKeys: ReadonlySet<string>,
  outputsPerPrompt: number,
  detailPrompts: Readonly<Record<string, string>> = {},
): Match[] {
  const slots: Slot[] = [...submissions]
    .sort((a, b) => a.seq - b.seq)
    .map((sub) => ({ sub, keys: [], filled: 0, refusal: null, absorb: 0, unconfirmed: false }));
  const oldestFirst = cards.filter((c) => !seenCardKeys.has(c.key)).sort((a, b) => b.domIndex - a.domIndex);

  let i = 0;
  let lastRefused: Slot | null = null;
  const closed = (s: Slot) => s.unconfirmed || s.refusal !== null || s.filled >= outputsPerPrompt;

  for (const card of oldestFirst) {
    // A refusal right after a refused submission, with its prompt, is the same submission's (one per output).
    if (card.refusal !== null && lastRefused && lastRefused.absorb > 0 && verifyMatch(lastRefused.sub.prompt, card.caption)) {
      lastRefused.absorb--;
      continue;
    }
    lastRefused = null;

    for (;;) {
      while (i < slots.length && closed(slots[i]!)) i++;
      const slot = slots[i];
      if (!slot) break; // surplus: nobody is owed a picture any more

      if (card.refusal !== null) {
        // A refused tile keeps the prompt as its caption: it refuses a scene only when that is the scene's prompt.
        if (verifyMatch(slot.sub.prompt, card.caption)) {
          slot.refusal = card.refusal;
          slot.absorb = outputsPerPrompt - slot.filled - 1;
          lastRefused = slot;
          break;
        }
        const laterOwner = slots.slice(i + 1).some((s) => !closed(s) && verifyMatch(s.sub.prompt, card.caption));
        const earlierOwner = slots.slice(0, i).some((s) => verifyMatch(s.sub.prompt, card.caption));
        if (earlierOwner && !laterOwner) break; // a surplus refusal of an earlier scene
        slot.unconfirmed = true; // never a refusal by position alone
        if (laterOwner) continue; // offer it to the scene it names
        break;
      }

      if (!isFinished(card)) {
        // In progress: its caption is still the prompt. A different submitted prompt means it isn't this scene's.
        const caption = normalise(card.caption);
        const isOther =
          caption !== '' &&
          !verifyMatch(slot.sub.prompt, card.caption) &&
          slots.some((s) => verifyMatch(s.sub.prompt, card.caption));
        if (!isOther) slot.filled++;
        break;
      }

      const detail = detailPrompts[card.key];
      if (detail === undefined || verifyMatch(slot.sub.prompt, detail)) {
        slot.keys.push(card.key);
        slot.filled++;
        break;
      }
      // Checked, and not this scene's. If it is a later open scene's, this scene's pictures aren't where they must be.
      const laterOwner = slots.slice(i + 1).some((s) => !closed(s) && verifyMatch(s.sub.prompt, detail));
      if (!laterOwner) break; // surplus or foreign: leave it unassigned
      slot.unconfirmed = true; // then offer the card to the next scene
    }
  }

  const out: Match[] = [];
  for (const s of slots) {
    const sceneId = s.sub.sceneId;
    if (s.unconfirmed) out.push({ kind: 'unconfirmed', sceneId, cardKeys: [] });
    else if (s.refusal !== null) out.push({ kind: 'refused', sceneId, cardKeys: [], message: s.refusal });
    else if (s.keys.length >= outputsPerPrompt) out.push({ kind: 'pictures', sceneId, cardKeys: s.keys });
  }
  return out;
}

/** The cards of a pictures match whose detail prompt hasn't been read yet. */
export function unverifiedKeys(match: Match, detailPrompts: Readonly<Record<string, string>>): string[] {
  return match.cardKeys.filter((k) => detailPrompts[k] === undefined);
}

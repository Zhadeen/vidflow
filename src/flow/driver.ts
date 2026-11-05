import type { AspectRatio } from '../store/projects';
import {
  ASPECT_ICON,
  LIMIT_PATTERN,
  POLICY_DIALOG_PATTERN,
  REFUSAL_PATTERN,
  SEL,
} from './selectors';

export interface FlowPageState {
  ready: boolean;
  signedInEmail: string | null;
  generating: boolean;
  limitMessage: string | null;
  policyDialog: boolean;
}

export interface FlowResultCard {
  key: string;
  caption: string;
  imageUrl: string | null;
  progress: number | null;
  refusal: string | null;
  domIndex: number;
}

/** What the page looked like just before Generate was pressed, to confirm the press started something. */
export interface FlowSnapshot {
  promptText: string;
  inProgress: number;
  keys: string[];
}

export type StartVerb = 'Start' | 'Resume';

export interface DetailRead {
  mediaId: string | null;
  prompt: string | null;
}

export interface FlowDriver {
  read(): FlowPageState;
  /** Waits (up to timeoutMs) for the prompt box and Generate, e.g. right after Flow opens a new project. */
  waitUntilReady(timeoutMs: number): Promise<boolean>;
  setImageMode(): Promise<void>;
  setAspect(a: AspectRatio): Promise<void>;
  setOutputs(n: 1 | 2 | 4): Promise<void>;
  attachReference(image: Blob): Promise<void>;
  /** Types the prompt, waits until Flow enables Generate (never enables it itself), returns its centre in viewport px. */
  prepareSubmit(prompt: string): Promise<{ x: number; y: number }>;
  resultCards(): FlowResultCard[];
  snapshot(): FlowSnapshot;
  /** True once Flow cleared the prompt box or showed a new in-progress tile; false after timeoutMs. */
  waitForStart(before: FlowSnapshot, timeoutMs: number): Promise<boolean>;
  /** Centre of the home page's "New project" button, or null when it isn't there. */
  newProjectButton(): { x: number; y: number } | null;
  /** Scrolls the finished tile with this media id into view and returns its centre, or null when it isn't in the DOM. */
  tilePoint(key: string): { x: number; y: number } | null;
  /**
   * On a picture's detail page: the full prompt of its first history step (the generation), and the media id of the
   * one element carrying data-media-id (the opened picture). Either is null when the page doesn't show it plainly.
   */
  readDetailPrompt(): DetailRead;
}

export type StartCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong-account' | 'signed-out' | 'policy-dialog' | 'page-not-recognised'; message: string };

/** `verb` names the button the owner will see: Start before a run, Resume for a paused one. */
export function checkCanStart(s: FlowPageState, expectedEmail: string, verb: StartVerb = 'Start'): StartCheck {
  const press = verb === 'Start' ? 'press Start again' : 'press Resume';
  if (s.policyDialog) {
    return {
      ok: false,
      reason: 'policy-dialog',
      message: `Flow is showing a message about its usage policy or billing. Read it in the Flow window, then ${press}.`,
    };
  }
  if (!s.signedInEmail) {
    return {
      ok: false,
      reason: 'signed-out',
      message: `Flow isn't signed in. Sign in to Flow as ${expectedEmail}, then ${press}.`,
    };
  }
  if (s.signedInEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
    const actual = s.signedInEmail;
    return {
      ok: false,
      reason: 'wrong-account',
      message: `Flow is signed in to ${actual}, but VidFlow is set to use ${expectedEmail}. Switch Flow to ${expectedEmail}, then ${press}.`,
    };
  }
  if (!s.ready) {
    return {
      ok: false,
      reason: 'page-not-recognised',
      message: `VidFlow doesn't recognise this Flow page. Open a Flow project in the VidFlow window, then ${press}.`,
    };
  }
  return { ok: true };
}

export interface DriverOptions {
  pollMs?: number;
  /** Overrides both waits below (tests). */
  timeoutMs?: number;
}

const SETTINGS_TIMEOUT_MS = 5_000;
const GENERATE_TIMEOUT_MS = 30_000;
const PERCENT_ONLY = /^(\d{1,3})\s?%$/;

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function isShown(el: Element): boolean {
  if (!el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  // jsdom has no layout; in Chrome this catches display:none / visibility:hidden ancestors.
  return typeof check === 'function' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent)
    ? check.call(el)
    : true;
}

function textNodes(root: Element): string[] {
  const out: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = squash(n.textContent);
    if (t) out.push(t);
  }
  return out;
}

function radioLabel(radio: Element): string {
  // Live Flow wraps the label in .toggle-text next to a <mat-icon> whose ligature name runs into it
  // ("imageImage", "crop_16_916:9"), so read the label element, or the text without icons.
  const label = radio.querySelector('.toggle-text');
  if (label) return squash(label.textContent);
  const copy = radio.cloneNode(true) as Element;
  copy.querySelectorAll('mat-icon, [aria-hidden="true"]').forEach((icon) => icon.remove());
  // Older/fixture markup reads like "crop_16_9 16:9" or "x2": the label is the last word.
  return squash(copy.textContent).split(' ').pop() ?? '';
}

export function createFlowDriver(doc: Document = document, opts: DriverOptions = {}): FlowDriver {
  const pollMs = opts.pollMs ?? 250;
  const q = <T extends Element = HTMLElement>(sel: string) => doc.querySelector<T>(sel);

  async function until<T>(probe: () => T | null | false | undefined, timeoutMs: number, failMessage: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = probe();
      if (value) return value;
      if (Date.now() >= deadline) throw new Error(failMessage);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // The trigger separates its parts with <br>, so join its text nodes with spaces: "🍌 Nano Banana 2.1 crop_9_16 x2".
  const triggerText = () => {
    const trigger = q(SEL.settingsTrigger);
    return trigger ? textNodes(trigger).join(' ') : '';
  };

  function findRadio(label: string): HTMLElement | null {
    for (const group of doc.querySelectorAll(SEL.radioGroup)) {
      for (const radio of group.querySelectorAll<HTMLElement>(SEL.radio)) {
        if (radioLabel(radio) === label) return radio;
      }
    }
    return null;
  }

  /** Clicks the radio labelled `label` in Flow's settings popover, opening (and closing) the popover if needed. */
  async function chooseSetting(label: string, confirmed: () => boolean): Promise<void> {
    const timeout = opts.timeoutMs ?? SETTINGS_TIMEOUT_MS;
    if (confirmed()) return;
    let opened = false;
    let radio = findRadio(label);
    if (!radio) {
      const trigger = q(SEL.settingsTrigger);
      if (!trigger) throw new Error("VidFlow can't find Flow's settings button.");
      trigger.click();
      opened = true;
      radio = await until(() => findRadio(label), timeout, `Flow's settings didn't open to set ${label}.`);
    }
    if (radio.getAttribute('aria-checked') !== 'true') radio.click();
    await until(confirmed, timeout, `Flow didn't switch to ${label}.`);
    if (opened && findRadio(label)) q(SEL.settingsTrigger)?.click(); // close the popover again
  }

  function resultCards(): FlowResultCard[] {
    const tiles = [...doc.querySelectorAll(SEL.tileList)].flatMap((list) => [...list.children]);
    return tiles.map((tile, domIndex) => {
      const img = tile.querySelector<HTMLImageElement>(SEL.tileImage);
      const texts = textNodes(tile);
      let progress: number | null = null;
      let refusal: string | null = null;
      const captionParts: string[] = [];
      for (const t of texts) {
        const pct = PERCENT_ONLY.exec(t);
        if (pct && progress === null) progress = Number(pct[1]);
        else if (!img && refusal === null && REFUSAL_PATTERN.test(t)) refusal = t;
        else if (!pct) captionParts.push(t);
      }
      return {
        key: img?.dataset.mediaId ?? `pending-${domIndex}`,
        caption: captionParts.join(' '),
        imageUrl: img ? img.src : null,
        progress,
        refusal: progress === null ? refusal : null,
        domIndex,
      };
    });
  }

  function readDetailPrompt(): DetailRead {
    const ids = doc.querySelectorAll<HTMLElement>(SEL.mediaId);
    const mediaId = ids.length === 1 ? ids[0]!.dataset.mediaId || null : null;
    // A freshly generated picture has one step; VidFlow never edits, so the first step is the generation's prompt.
    const step = q(SEL.detailStep);
    // The prompt may be split over several text parts: join them as written.
    const parts = step ? [...step.querySelectorAll(SEL.detailPromptText)].map((p) => p.textContent ?? '') : [];
    const prompt = squash(parts.join(''));
    return { mediaId, prompt: prompt || null };
  }

  function read(): FlowPageState {
    const accountLabel = q(SEL.account)?.getAttribute('aria-label') ?? '';
    const email = /\(([^()\s]+@[^()\s]+)\)/.exec(accountLabel)?.[1] ?? null;

    let limitMessage: string | null = null;
    let policyDialog = false;
    for (const el of doc.querySelectorAll(`${SEL.notice}, ${SEL.dialog}`)) {
      if (!isShown(el)) continue;
      const text = squash(el.textContent);
      if (el.matches(SEL.dialog) && POLICY_DIALOG_PATTERN.test(text)) policyDialog = true;
      if (limitMessage === null && LIMIT_PATTERN.test(text)) limitMessage = text;
    }

    return {
      ready: !!q(SEL.promptBox) && !!q(SEL.generate),
      signedInEmail: email,
      generating: resultCards().some((c) => c.progress !== null),
      limitMessage,
      policyDialog,
    };
  }

  const centre = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };

  function snapshot(): FlowSnapshot {
    const cards = resultCards();
    return {
      promptText: squash(q(SEL.promptBox)?.textContent),
      inProgress: cards.filter((c) => c.progress !== null).length,
      keys: cards.map((c) => c.key).filter((k) => !k.startsWith('pending-')),
    };
  }

  function started(before: FlowSnapshot): boolean {
    const now = snapshot();
    if (before.promptText !== '' && now.promptText === '') return true;
    if (now.inProgress > before.inProgress) return true;
    return now.keys.some((k) => !before.keys.includes(k));
  }

  return {
    read,
    resultCards,
    snapshot,

    async waitForStart(before, timeoutMs) {
      try {
        await until(() => started(before), timeoutMs, 'not started');
        return true;
      } catch {
        return false;
      }
    },

    async waitUntilReady(timeoutMs) {
      try {
        await until(() => read().ready, timeoutMs, 'not ready');
        return true;
      } catch {
        return false;
      }
    },

    readDetailPrompt,

    tilePoint(key) {
      const img = [...doc.querySelectorAll<HTMLImageElement>(SEL.tileImage)].find((i) => i.dataset.mediaId === key);
      if (!img) return null;
      img.scrollIntoView({ block: 'center' });
      return centre(img);
    },

    newProjectButton() {
      // Flow's icon ligature runs into the label ("addNew project"), so no word boundary before "new".
      const button = [...doc.querySelectorAll('button, [role="button"], a')].find((b) =>
        /new\s*project\b/i.test(squash(b.textContent)),
      );
      if (!button) return null;
      // The button sits below the fold on Flow's home page; bring it on screen before measuring.
      button.scrollIntoView?.({ block: 'center' });
      return centre(button);
    },

    setImageMode() {
      return chooseSetting('Image', () => findRadio('Image')?.getAttribute('aria-checked') === 'true');
    },

    setAspect(a) {
      const icon = ASPECT_ICON[a];
      return chooseSetting(a, () => triggerText().includes(icon));
    },

    setOutputs(n) {
      return chooseSetting(`x${n}`, () => new RegExp(`\\bx${n}\\b`).test(triggerText()));
    },

    async attachReference() {
      // Deferred to Plan 2 (spike S5 did not explore Flow's ingredient upload). Nothing calls this yet.
      throw new Error("Adding a reference picture isn't available yet.");
    },

    async prepareSubmit(prompt) {
      const box = q(SEL.promptBox);
      if (!box) throw new Error("VidFlow can't find Flow's prompt box.");
      box.focus();
      // Spike S5: execCommand insertText is what Flow's editor accepts from the DOM.
      doc.execCommand('selectAll');
      doc.execCommand('insertText', false, prompt);
      if (squash(box.textContent) !== squash(prompt)) throw new Error("VidFlow couldn't type the prompt into Flow.");

      const button = await until(
        () => {
          const b = q<HTMLButtonElement>(SEL.generate);
          return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
        },
        opts.timeoutMs ?? GENERATE_TIMEOUT_MS,
        "Flow's Generate button didn't become ready in 30 seconds.",
      );
      const at = centre(button);
      if (!at) throw new Error("Flow's Generate button isn't visible.");
      return at;
    },
  };
}

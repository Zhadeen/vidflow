import type { AspectRatio } from '../store/projects';
import { FlowBlockedError, REFERENCE_ATTACH_MESSAGE, STRAY_INGREDIENT_MESSAGE } from './messages';
import {
  ASPECT_ICON,
  BILLING_PATTERN,
  LIMIT_PATTERN,
  NOTICE_ACCEPT_PATTERN,
  REFUSAL_PATTERN,
  SEL,
  USAGE_NOTICE_PATTERN,
} from './selectors';

export interface FlowPageState {
  ready: boolean;
  signedInEmail: string | null;
  generating: boolean;
  limitMessage: string | null;
  /** Flow's usage-policy / rights notice is open (and no billing dialog wording): VidFlow may accept it. */
  noticeDialog: boolean;
  /** A billing / payment / upgrade dialog is open: never accepted; the run stops with a plain message. */
  billingDialog: boolean;
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
  /**
   * Uploads the hero reference into this Flow project's assets through the ingredients picker (spike S7), unless an
   * asset with the file's name is already there, and waits until Flow has finished uploading it. Returns the media id
   * of the grid tile the upload makes, or null when that tile didn't show in time. FlowBlockedError when it can't.
   */
  uploadReference(file: File): Promise<string | null>;
  /**
   * Attaches the uploaded asset with this name to the prompt (Flow's Generate clears it, so once per prompt).
   * Afterwards the prompt bar shows exactly one ingredient, the reference. FlowBlockedError when it can't.
   */
  attachReference(name: string): Promise<void>;
  /** True while the prompt bar shows exactly one ingredient. */
  hasReference(): boolean;
  /** Turns Flow's sticky Agent mode off (it would take the prompt instead of making pictures); never turns it on. */
  turnOffAgentMode(): Promise<void>;
  /**
   * Types the prompt, waits until Flow enables Generate (never enables it itself), returns its centre in viewport px.
   * With `reference`, throws FlowBlockedError instead of answering when the reference's chip isn't in the bar.
   */
  prepareSubmit(prompt: string, opts?: { reference?: boolean }): Promise<{ x: number; y: number }>;
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
  /**
   * Accepts Flow's open usage-policy / rights notice: ticks its unticked boxes, waits for its accept button ("I
   * understand", "I agree"…) to be ready and presses it. Never touches a billing dialog. False when there is no such
   * notice or no ready accept button.
   */
  acceptNotice(): Promise<boolean>;
  /** Flow's model, aspect and outputs as its settings button shows them (the popover is never opened); null parts unknown. */
  readSettings(): FlowSettingsRead;
  /** Flow's credit balance, only when the page shows it without opening a menu; otherwise null. */
  readCredits(): number | null;
  /** True while Flow's Agent mode chip is pressed. */
  agentModeOn(): boolean;
  /** Empties the prompt box (Flow's Clear prompt button, else select-all and delete); true once it is empty. */
  clearPrompt(): Promise<boolean>;
}

export interface FlowSettingsRead {
  model: string | null;
  aspect: AspectRatio | null;
  outputs: number | null;
}

export type StartCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong-account' | 'signed-out' | 'policy-dialog' | 'page-not-recognised'; message: string };

const pressWord = (verb: StartVerb) => (verb === 'Start' ? 'press Start again' : 'press Resume');

/** Said when Flow's usage notice (switch off, or it couldn't be accepted) or a billing dialog stops VidFlow. */
export function policyDialogMessage(verb: StartVerb): string {
  return `Flow is showing a message about its usage policy or billing. Read it in the Flow window, then ${pressWord(verb)}.`;
}

/** `verb` names the button the owner will see: Start before a run, Resume for a paused one. */
export function checkCanStart(s: FlowPageState, expectedEmail: string, verb: StartVerb = 'Start'): StartCheck {
  const press = pressWord(verb);
  if (s.billingDialog || s.noticeDialog) {
    return { ok: false, reason: 'policy-dialog', message: policyDialogMessage(verb) };
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
const PICKER_TIMEOUT_MS = 5_000;
/** Spike S7: an upload read "Uploading" for 5–10 s. */
const UPLOAD_TIMEOUT_MS = 30_000;
const REFERENCE_TILE_TIMEOUT_MS = 10_000;
const ASSETS_LOAD_WAIT_MS = 1_500;
const CLOSE_WAIT_MS = 1_000;
const AGENT_OFF_TRIES = 3;
const AGENT_MODE_MESSAGE =
  "Flow's Agent mode is on and VidFlow couldn't turn it off. Turn it off in the Flow window, then press Resume.";
const PERCENT_ONLY = /^(\d{1,3})\s?%$/;
/** A balance ("1,250 credits left", "Credits: 40"); never the popover's "Generating will use 0 credits" cost note. */
const CREDITS_BALANCE = /^(?:(\d[\d,]*)\s+(?:ai\s+)?credits?\s+(?:left|remaining|available)|(?:ai\s+)?credits?\s*(?:left|remaining|available)?\s*:\s*(\d[\d,]*))$/i;

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The finished picture with this Flow media id (compared, never put in a selector), or null. */
export function tileImage(doc: Document, key: string): HTMLImageElement | null {
  return [...doc.querySelectorAll<HTMLImageElement>(SEL.tileImage)].find((i) => i.dataset.mediaId === key) ?? null;
}

/** The tile a picture sits in: Flow's flow-grid-tile-container, else the tile list's child (older layout). */
export function tileContainer(img: Element): Element {
  return img.closest(SEL.tile) ?? img.closest(`${SEL.tileList} > *`) ?? img;
}

/** Flow's "New project" button on its home page. */
export function findNewProjectButton(doc: Document): Element | null {
  // Flow's icon ligature runs into the label ("addNew project"), so no word boundary before "new".
  return [...doc.querySelectorAll('button, [role="button"], a')].find((b) => /new\s*project\b/i.test(squash(b.textContent))) ?? null;
}

function isShown(el: Element): boolean {
  if (!el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  // jsdom has no layout; in Chrome this catches display:none / visibility:hidden ancestors.
  return typeof check === 'function' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent)
    ? check.call(el)
    : true;
}

function textNodes(root: Element, skipIcons = false): string[] {
  const out: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // Material icon ligatures ("image", "add") are text too; they aren't part of a caption.
    if (skipIcons && n.parentElement?.closest('mat-icon')) continue;
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
    // Live Flow puts every tile in one row div, each picture in its own flow-grid-tile-container.
    const live = [...doc.querySelectorAll(SEL.tile)];
    const tiles = live.length ? live : [...doc.querySelectorAll(SEL.tileList)].flatMap((list) => [...list.children]);
    return tiles.map((tile, domIndex) => {
      const img = tile.querySelector<HTMLImageElement>(SEL.tileImage);
      const texts = textNodes(tile, true);
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
    for (const el of doc.querySelectorAll(`${SEL.notice}, ${SEL.dialog}`)) {
      if (!isShown(el)) continue;
      const text = squash(el.textContent);
      if (limitMessage === null && LIMIT_PATTERN.test(text)) limitMessage = text;
    }
    const dialogs = shownDialogs();

    return {
      ready: !!q(SEL.promptBox) && !!q(SEL.generate),
      signedInEmail: email,
      generating: resultCards().some((c) => c.progress !== null),
      limitMessage,
      noticeDialog: dialogs.some(isUsageNotice),
      billingDialog: dialogs.some(isBilling),
    };
  }

  // ---- Flow's notices -------------------------------------------------------
  const shownDialogs = () => [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].filter(isShown);
  const isBilling = (dialog: Element) => BILLING_PATTERN.test(squash(dialog.textContent));
  /** A usage-policy / rights notice; billing wording anywhere in it makes it a billing dialog instead. */
  const isUsageNotice = (dialog: Element) => !isBilling(dialog) && USAGE_NOTICE_PATTERN.test(squash(dialog.textContent));
  const enabled = (b: HTMLElement) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true';

  /**
   * Stops a step that is waiting on Flow when a dialog covers the page: a usage notice (no billing dialog) as a
   * notice the background may accept, a billing dialog as a plain stop. Unknown dialogs: the step's own wait decides.
   */
  function stopForDialog(): void {
    const dialogs = shownDialogs();
    const billing = dialogs.some(isBilling);
    if (!billing && !dialogs.some(isUsageNotice)) return;
    throw new FlowBlockedError({ type: 'needsOwner', reason: 'policy-dialog', message: policyDialogMessage('Resume') }, !billing);
  }

  async function acceptNotice(): Promise<boolean> {
    // Never act while any billing dialog is open, even next to a notice.
    if (shownDialogs().some(isBilling)) return false;
    const notice = shownDialogs().find(isUsageNotice);
    if (!notice) return false;
    const acceptButton = () =>
      [...notice.querySelectorAll<HTMLElement>('button, [role="button"]')].find((b) =>
        NOTICE_ACCEPT_PATTERN.test(squash(b.textContent)),
      ) ?? null;
    if (!acceptButton()) return false;
    for (const box of notice.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (!box.checked && !box.disabled) box.click();
    }
    // A role=checkbox wrapper around a native box was ticked through that box: clicking it too would untick it.
    for (const box of notice.querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked="false"]')) {
      if (!box.querySelector('input[type="checkbox"]')) box.click();
    }
    let button: HTMLElement;
    try {
      button = await until(() => {
        const b = acceptButton();
        return b && enabled(b) ? b : null;
      }, opts.timeoutMs ?? SETTINGS_TIMEOUT_MS, 'not ready');
    } catch {
      return false;
    }
    button.click();
    await until(() => !notice.isConnected || !isShown(notice), CLOSE_WAIT_MS, 'still open').catch(() => undefined);
    return true;
  }

  // ---- Hero reference (spike S7) ---------------------------------------------
  const blocked = (message = REFERENCE_ATTACH_MESSAGE) =>
    new FlowBlockedError({ type: 'needsOwner', reason: 'page-not-recognised', message });

  /** Like until(), but a timeout pauses the run with `message` instead of failing the scene. */
  async function untilOrBlocked<T>(probe: () => T | null | false | undefined, timeoutMs: number, message?: string): Promise<T> {
    try {
      return await until(() => (stopForDialog(), probe()), timeoutMs, 'timed out');
    } catch (err) {
      if (err instanceof FlowBlockedError) throw err;
      throw blocked(message);
    }
  }

  /** Like until(), but null on a timeout; a notice or billing dialog still stops it at once (stopForDialog). */
  async function untilWatching<T>(probe: () => T | null | false | undefined, timeoutMs: number): Promise<T | null> {
    try {
      return await until(() => (stopForDialog(), probe()), timeoutMs, 'timed out');
    } catch (err) {
      if (err instanceof FlowBlockedError) throw err;
      return null;
    }
  }

  const overlayRoot = (): ParentNode => q(SEL.overlay) ?? doc;
  const overlayButton = (text: string) =>
    [...overlayRoot().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => squash(b.textContent).includes(text) && !b.disabled && b.getAttribute('aria-disabled') !== 'true',
    ) ?? null;
  /** The asset with this name in the open picker (text "<name> Image", or "Uploading <name>" while uploading). */
  // Read as separate text parts: textContent glues "Uploading" onto the name.
  const optionParts = (option: Element) => textNodes(option, true);
  const findAsset = (name: string) =>
    [...(q(SEL.assetList)?.querySelectorAll<HTMLElement>(SEL.assetOption) ?? [])].find((o) =>
      optionParts(o).some((t) => t.includes(name)),
    ) ?? null;
  const isUploading = (option: Element) => optionParts(option).some((t) => /^Uploading\b/i.test(t));
  const readyAsset = (name: string) => {
    const option = findAsset(name);
    return option && !isUploading(option) ? option : null;
  };
  const chips = () => doc.querySelectorAll(SEL.ingredientChip).length;

  /** The open picker: its asset list, or (in a brand-new Flow project, which says "No assets found.") its Upload button. */
  const pickerOpen = () => q(SEL.assetList) ?? overlayButton('Upload media');

  async function openPicker(): Promise<void> {
    if (pickerOpen()) return;
    const trigger = q(SEL.ingredients);
    if (!trigger) throw blocked();
    trigger.click();
    await untilOrBlocked(pickerOpen, opts.timeoutMs ?? PICKER_TIMEOUT_MS);
  }

  /** The tile Flow adds to the grid for an uploaded picture carries its file name as caption. */
  function referenceTileKey(name: string): string | null {
    for (const tile of doc.querySelectorAll(SEL.tile)) {
      const img = tile.querySelector<HTMLImageElement>(SEL.tileImage);
      if (img?.dataset.mediaId && textNodes(tile, true).some((t) => t.includes(name))) return img.dataset.mediaId;
    }
    return null;
  }

  /** Closes the picker; carries on if it stays open. */
  async function closePicker(): Promise<void> {
    // Flow's overlay closes on an Escape that comes from inside it (live, 5 Nov 2026); one sent to the document does nothing.
    const inside = pickerOpen();
    if (!inside) return;
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await until(() => !pickerOpen(), CLOSE_WAIT_MS, 'still open').catch(() => undefined);
  }


  async function uploadReference(file: File): Promise<string | null> {
    stopForDialog();
    const pickerWait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    await openPicker();
    // Flow fills the list a moment after the picker opens: an empty list doesn't yet mean "not uploaded".
    await untilWatching(() => !!q(SEL.assetList)?.querySelector(SEL.assetOption), ASSETS_LOAD_WAIT_MS);
    // Flow answers "Upload media" by clicking a file input in <body>. That click must never open the Mac file window: a
    // cancelled click doesn't (and a click without a user gesture can't anyway). Capture listeners see the page's own
    // events, so this works from the content script's isolated world. The input it clicked is the one Flow listens to;
    // another file input left in the page is never used. Flow may click again while the upload is under way, so the
    // guard stays until the picker has closed (or the upload gave up).
    let clicked: HTMLInputElement | null = null;
    const noFileWindow = (e: Event) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'file') return;
      e.preventDefault();
      clicked = e.target;
    };
    let guarded = false;
    try {
      if (!findAsset(file.name)) {
        const upload = overlayButton('Upload media');
        if (!upload) throw blocked();
        const before = new Set(doc.querySelectorAll(SEL.fileInput));
        doc.addEventListener('click', noFileWindow, true);
        guarded = true;
        upload.click();
        const input = await untilOrBlocked(
          () => clicked ?? [...doc.querySelectorAll<HTMLInputElement>(SEL.fileInput)].filter((i) => !before.has(i)).pop(),
          pickerWait,
        );
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await untilOrBlocked(() => readyAsset(file.name), opts.timeoutMs ?? UPLOAD_TIMEOUT_MS);
      await closePicker();
    } finally {
      if (guarded) doc.removeEventListener('click', noFileWindow, true);
    }
    // null when the tile doesn't show: the coordinator also recognises it by its file-name caption.
    return untilWatching(() => referenceTileKey(file.name), opts.timeoutMs ?? REFERENCE_TILE_TIMEOUT_MS);
  }

  async function attachReference(name: string): Promise<void> {
    stopForDialog();
    const wait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    if (chips() > 0) {
      // A chip left from an earlier attempt: start from an empty bar so exactly one ingredient remains.
      const clear = q(SEL.clearPrompt);
      if (!clear) throw blocked();
      clear.click();
      await untilOrBlocked(() => chips() === 0, wait);
    }
    await openPicker();
    const option = await untilOrBlocked(() => readyAsset(name), wait);
    option.click();
    const add = await untilOrBlocked(() => overlayButton('Add to prompt'), wait);
    add.click();
    await untilOrBlocked(() => chips() === 1, wait);
  }

  async function turnOffAgentMode(): Promise<void> {
    const wait = opts.timeoutMs ?? SETTINGS_TIMEOUT_MS;
    for (let i = 0; i < AGENT_OFF_TRIES; i++) {
      const on = q(SEL.agentModeOn);
      if (!on) return;
      on.click();
      await until(() => !q(SEL.agentModeOn), wait, 'still on').catch(() => undefined);
    }
    if (q(SEL.agentModeOn)) throw blocked(AGENT_MODE_MESSAGE);
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

  function readSettings(): FlowSettingsRead {
    if (!q(SEL.settingsTrigger)) return { model: null, aspect: null, outputs: null };
    const text = triggerText();
    const aspect = (Object.keys(ASPECT_ICON) as AspectRatio[]).find((a) => text.includes(ASPECT_ICON[a])) ?? null;
    const outputs = /\bx(\d)\b/.exec(text);
    // What is left once the icon names and the outputs are taken out, without a leading emoji: "Nano Banana 2.1".
    const model = squash(text.replace(/\bcrop_\w+/g, ' ').replace(/\bx\d\b/g, ' ')).replace(/^[^\p{L}\p{N}]+/u, '');
    return { model: model || null, aspect, outputs: outputs ? Number(outputs[1]) : null };
  }

  function readCredits(): number | null {
    // Only what is on the page now: the settings popover's cost note is skipped, and no menu is opened to look.
    for (const el of doc.querySelectorAll<HTMLElement>('body *')) {
      if (el.children.length > 0 || el.closest('.settings-popover, [role="menu"], [role="listbox"]')) continue;
      const m = CREDITS_BALANCE.exec(squash(el.textContent));
      if (m && isShown(el)) return Number((m[1] ?? m[2])!.replace(/,/g, ''));
    }
    return null;
  }

  async function clearPrompt(): Promise<boolean> {
    const box = q(SEL.promptBox);
    if (!box) return false;
    const empty = () => squash(q(SEL.promptBox)?.textContent) === '';
    if (empty()) return true;
    const clear = q(SEL.clearPrompt);
    if (clear) {
      clear.click();
      if (await until(empty, opts.timeoutMs ?? PICKER_TIMEOUT_MS, 'not cleared').catch(() => false)) return true;
    }
    box.focus();
    doc.execCommand('selectAll');
    doc.execCommand('delete');
    return empty();
  }

  return {
    read,
    resultCards,
    snapshot,
    readSettings,
    readCredits,
    agentModeOn: () => !!q(SEL.agentModeOn),
    clearPrompt,

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
    acceptNotice,

    tilePoint(key) {
      const img = tileImage(doc, key);
      if (!img) return null;
      img.scrollIntoView({ block: 'center' });
      return centre(img);
    },

    newProjectButton() {
      const button = findNewProjectButton(doc);
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

    uploadReference,
    attachReference,
    hasReference: () => chips() === 1,
    turnOffAgentMode,

    async prepareSubmit(prompt, submitOpts = {}) {
      const box = q(SEL.promptBox);
      if (!box) throw new Error("VidFlow can't find Flow's prompt box.");
      // A prompt must never carry an Ingredient it doesn't mention: one left in the bar goes first (Clear prompt also
      // empties the text, so this comes before typing). If it can't go, the run pauses.
      if (!submitOpts.reference && chips() > 0) {
        const clear = q(SEL.clearPrompt);
        if (!clear) throw blocked(STRAY_INGREDIENT_MESSAGE);
        clear.click();
        await untilOrBlocked(() => chips() === 0, opts.timeoutMs ?? PICKER_TIMEOUT_MS, STRAY_INGREDIENT_MESSAGE);
      }
      box.focus();
      // Spike S5: execCommand insertText is what Flow's editor accepts from the DOM.
      doc.execCommand('selectAll');
      doc.execCommand('insertText', false, prompt);
      // Flow turns each line into a <p>, and textContent glues the paragraphs together, so compare without whitespace.
      const bare = (s: string | null) => (s ?? '').replace(/\s+/g, '');
      if (bare(box.textContent) !== bare(prompt)) throw new Error("VidFlow couldn't type the prompt into Flow.");

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
      // Never answer ready for a prompt that names the reference picture while its chip isn't there.
      if (submitOpts.reference && chips() !== 1) throw blocked();
      return at;
    },
  };
}

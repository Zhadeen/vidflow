import type { ClipLength } from '../motion/timing';
import type { AspectRatio } from '../store/projects';
import {
  AGENT_ASK_MESSAGE,
  FlowBlockedError,
  REFERENCE_ATTACH_MESSAGE,
  START_FRAME_MESSAGE,
  STRAY_INGREDIENT_MESSAGE,
} from './messages';
import {
  ASPECT_ICON,
  ANNOUNCEMENT_CLOSE_PATTERN,
  ANNOUNCEMENT_MORE_PATTERN,
  BILLING_PATTERN,
  CLIP_URL_PREFIX,
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
  /** Flow's "What's new" announcement is open (spike S8): VidFlow closes it with "Get started" and carries on. */
  announcement: boolean;
}

export interface FlowResultCard {
  key: string;
  caption: string;
  imageUrl: string | null;
  progress: number | null;
  refusal: string | null;
  domIndex: number;
  /** A finished clip (spike S8): keyed by its grid position, as Flow gives video tiles no media id. */
  video?: true;
}

/** What the page looked like just before Generate was pressed, to confirm the press started something. */
export interface FlowSnapshot {
  promptText: string;
  inProgress: number;
  keys: string[];
}

/** The button the owner presses next: Start before a run, Resume for a paused one, or Test one prompt ("try again"). */
export type StartVerb = 'Start' | 'Resume' | 'Test';

export interface DetailRead {
  mediaId: string | null;
  prompt: string | null;
}

/** On a clip's page (/project/<p>/edit/<editId>): its prompt, and the edit id from the URL (not the media id). */
export interface VideoDetailRead {
  prompt: string | null;
  editId: string | null;
  /**
   * Always null: the clip's start frame (an "Ingredient" chip) shows no name, and the vidflow-sNN.png names on the page
   * are Flow's media rail listing the project's uploads, not this clip's frame (S8, checked live 6 Nov). The
   * coordinator never uses it.
   */
  startFrame: string | null;
}

/** A finished clip's file: Flow's signed URL and the media id it names. */
export interface ClipFile {
  url: string;
  mediaId: string;
}

export interface CreditBalance {
  credits: number;
  /** "13 Nov at 13:50", or null when the panel doesn't say. */
  resets: string | null;
}

export interface SubmitCheck {
  /** The hero reference: exactly one Ingredient chip must show. */
  reference?: boolean;
  /** This many Ingredient chips must show (Agent questions); wins over `reference`. */
  ingredients?: number;
  /** A clip: its start frame must sit in the Start slot. */
  startFrame?: boolean;
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
  prepareSubmit(prompt: string, opts?: SubmitCheck): Promise<{ x: number; y: number }>;
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
  /** When the credits reset ("13 Nov"), only when the page shows it beside the balance; never opens a menu. */
  readCreditsResets(): string | null;
  /** True while Flow's Agent mode chip is pressed. */
  agentModeOn(): boolean;
  /** Empties the prompt box (Flow's Clear prompt button, else select-all and delete); true once it is empty. */
  clearPrompt(): Promise<boolean>;
  /**
   * Closes Flow's open "What's new" announcement with its "Get started" button (never "View all changelogs");
   * true when it pressed it. Also done by every step that watches for dialogs. Logs nothing: the background does.
   */
  dismissAnnouncement(): boolean;
  /** How many announcements this helper has closed (the background logs "Closed Flow's announcement" per new one). */
  announcementsClosed(): number;

  // ---- Clips (spike S8) ----
  setVideoMode(): Promise<void>;
  setFramesMode(): Promise<void>;
  setClipLength(s: ClipLength): Promise<void>;
  setResolution720(): Promise<void>;
  /**
   * Uploads a clip's start picture through the Start slot's "Select a frame image" picker (never opening the file
   * window), unless an asset with its name is already there; waits until it is ready, then closes the picker.
   */
  uploadStartFrame(file: File): Promise<void>;
  /**
   * Uploads one of a slide's pictures for Auto-pick through the ingredients picker (Flow is in Image mode then, with no
   * Start slot), unless an asset with its name is already there. Pauses with the Agent message when it can't.
   */
  uploadAgentPicture(file: File): Promise<void>;
  /** Attaches the asset with this name to the Start slot (Generate clears it, so once per clip); End stays empty. */
  attachStartFrame(name: string): Promise<void>;
  /** True while the Start slot holds a picture and End is empty. */
  hasStartFrame(): boolean;
  /** "Generating will use N credits" from the settings popover (opened and closed again if needed); null if not shown. */
  readGenerateCost(): Promise<number | null>;
  /** Opens Account details (project grid page), reads the balance and reset date, and always closes it again. */
  readCreditBalance(): Promise<CreditBalance | null>;
  /** True while Flow's Account details panel is open (it should be closed again after reading the balance). */
  accountPanelOpen(): boolean;
  /** The grid's tiles in order: drawing clips, finished clips (video: true, no media id) and picture tiles. */
  videoResultCards(): FlowResultCard[];
  readVideoDetail(): VideoDetailRead;
  /**
   * On a clip's page: Download media → "720p Original size" (never another choice), then the newest signed
   * flow-content.google/video/<id> URL Flow fetched since; null after timeoutMs.
   */
  clipFileUrl(timeoutMs: number): Promise<ClipFile | null>;

  // ---- Agent questions (spikes S6/S7) ----
  /**
   * Turns Agent mode on, attaches the named assets in order, types the question and answers with where the send
   * button is (the background presses it). On any failure the Agent panel is closed and Agent mode turned off first.
   */
  prepareAgentQuestion(names: string[], question: string): Promise<{ x: number; y: number }>;
  /** The Agent's reply to the question just sent, once its text has settled; null after waitMs (asked again later). */
  readAgentReply(waitMs: number): Promise<string | null>;
  /** Closes the Agent panel and turns Agent mode off; never throws. True when both are done. */
  finishAgent(): Promise<boolean>;
  /** True while a question sent by this helper waits for its reply (false after a page reload). */
  agentQuestionPending(): boolean;
  /**
   * Right before the background presses send: true only while Agent mode is on and the prompt still holds the prepared
   * question with its pictures. Otherwise the press could be a real Generate, so it must not happen.
   */
  agentReady(): boolean;
}

export interface FlowSettingsRead {
  model: string | null;
  aspect: AspectRatio | null;
  outputs: number | null;
}

export type StartCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong-account' | 'signed-out' | 'policy-dialog' | 'page-not-recognised'; message: string };

const pressWord = (verb: StartVerb) => (verb === 'Start' ? 'press Start again' : verb === 'Resume' ? 'press Resume' : 'try again');

/** Said when Flow's usage notice (switch off, or it couldn't be accepted) or a billing dialog stops VidFlow. */
export function policyDialogMessage(verb: StartVerb): string {
  return `Flow is showing a message about its usage policy or billing. Read it in the Flow window, then ${pressWord(verb)}.`;
}

/** `verb` names the button the owner will see: Start before a run, Resume for a paused one, Test for Test one prompt. */
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
  /** How long an Agent reply must stay unchanged before it counts as finished. */
  settleMs?: number;
  /** The page's performance timeline (tests). */
  perf?: Pick<Performance, 'now' | 'getEntriesByType'>;
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
/** Agent replies may stream in; one unchanged this long is taken as finished. */
const AGENT_SETTLE_MS = 2_000;
/** The title of the Start slot's picker (spike S8), telling it apart from the ingredients picker. */
const FRAME_PICKER_TITLE = /select a frame image/i;
const CREDIT_BALANCE = /(\d[\d,]*)\s+Google\s+Flow\s+credits?/i;
const CREDIT_RESETS = /^Resets\s+(?:on\s+)?(.+)$/i;
const GENERATE_COST = /will\s+use\s+(\d[\d,]*)\s+credits?/i;
const AGENT_MODE_MESSAGE =
  "Flow's Agent mode is on and VidFlow couldn't turn it off. Turn it off in the Flow window, then press Resume.";
const PERCENT_ONLY = /^(\d{1,3})\s?%$/;
/** A balance ("1,250 credits left", "Credits: 40"); never the popover's "Generating will use 0 credits" cost note. */
const CREDITS_BALANCE = /^(?:(\d[\d,]*)\s+(?:ai\s+)?credits?\s+(?:left|remaining|available)|(?:ai\s+)?credits?\s*(?:left|remaining|available)?\s*:\s*(\d[\d,]*))$/i;

/** "Resets on 13 Nov", "(resets 1 Dec)". */
const CREDITS_RESETS = /^\(?\s*resets?\s+(?:on\s+)?([\p{L}\p{N} ,]{1,24}?)\s*\)?$/iu;

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
    return tiles.map((tile, domIndex) => readCard(tile, domIndex));
  }

  /** One grid tile as a card: caption (icon text left out), percentage, refusal, and its picture's media id. */
  function readCard(tile: Element, domIndex: number, video = false): FlowResultCard {
    const img = tile.querySelector<HTMLImageElement>(video ? 'img' : SEL.tileImage);
    // A finished clip's caption sits beside its flow-video-tile, in the flow-tile-container around it.
    const container = video ? tile.closest(SEL.videoTileContainer) : null;
    const textRoot = container && container.querySelectorAll(SEL.videoTile).length === 1 ? container : tile;
    let progress: number | null = null;
    let refusal: string | null = null;
    const captionParts: string[] = [];
    for (const t of textNodes(textRoot, true)) {
      const pct = PERCENT_ONLY.exec(t);
      if (pct && progress === null) progress = Number(pct[1]);
      else if (!img && refusal === null && REFUSAL_PATTERN.test(t)) refusal = t;
      else if (!pct) captionParts.push(t);
    }
    return {
      key: video ? `video-${domIndex}` : (img?.dataset.mediaId ?? `pending-${domIndex}`),
      caption: captionParts.join(' '),
      imageUrl: img ? img.src : null,
      progress,
      refusal: progress === null ? refusal : null,
      domIndex,
      ...(video ? { video: true as const } : {}),
    };
  }

  function videoResultCards(): FlowResultCard[] {
    // Spike S8: a drawing clip is a flow-grid-tile-container; a finished one a flow-video-tile (no media id).
    const tiles = [...doc.querySelectorAll(`${SEL.videoTile}, ${SEL.tile}`)].filter(
      (t) => !(t.matches(SEL.tile) && t.querySelector(SEL.videoTile)),
    );
    return tiles.map((tile, domIndex) => readCard(tile, domIndex, tile.matches(SEL.videoTile)));
  }

  function readVideoDetail(): VideoDetailRead {
    const prompt = q('flow-expandable-prompt');
    const parts = prompt ? [...prompt.querySelectorAll(SEL.detailPromptText)].map((p) => p.textContent ?? '') : [];
    const text = squash(parts.join(''));
    const editId = /\/edit\/([^/?#]+)/.exec(doc.location?.pathname ?? '')?.[1] ?? null;
    // The media rail (flow-navigation-rail-thumbnail) lists every upload by name: never read as this clip's frame.
    return { prompt: text || null, editId: editId ? decodeURIComponent(editId) : null, startFrame: null };
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
      announcement: !!announcementButton(),
    };
  }

  // ---- Flow's notices -------------------------------------------------------
  // Flow's own Account details panel (opened by readCreditBalance) is neither a notice nor billing, whatever it says.
  // An announcement is told apart by its two buttons (Get started + View all changelogs), not its wording, which may
  // name plans ("for Ultra subscribers"); a billing dialog never has View all changelogs.
  const buttonsIn = (el: Element) => [...el.querySelectorAll<HTMLElement>('button, [role="button"]')];
  const isAnnouncement = (el: Element) => {
    const labels = buttonsIn(el).map((b) => squash(textNodes(b, true).join(' ')));
    return labels.some((l) => ANNOUNCEMENT_CLOSE_PATTERN.test(l)) && labels.some((l) => ANNOUNCEMENT_MORE_PATTERN.test(l));
  };
  const shownDialogs = () =>
    [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].filter(
      (d) => isShown(d) && !d.querySelector(SEL.closeAccountPanel) && !isAnnouncement(d),
    );
  function announcementButton(): HTMLElement | null {
    const box = [...doc.querySelectorAll<HTMLElement>(`${SEL.dialog}, .cdk-overlay-pane`)].find((el) => isShown(el) && isAnnouncement(el));
    return box ? (buttonsIn(box).find((b) => ANNOUNCEMENT_CLOSE_PATTERN.test(squash(textNodes(b, true).join(' ')))) ?? null) : null;
  }
  let closedAnnouncements = 0;
  const pressedAt = new WeakMap<Element, number>();
  function dismissAnnouncement(): boolean {
    const button = announcementButton();
    if (!button) return false;
    // Pressed again only if it is still there a second later (each poll would otherwise press it).
    const last = pressedAt.get(button);
    if (last !== undefined && Date.now() - last < CLOSE_WAIT_MS) return false;
    if (last === undefined) closedAnnouncements += 1;
    pressedAt.set(button, Date.now());
    button.click();
    return true;
  }
  const isBilling = (dialog: Element) => BILLING_PATTERN.test(squash(dialog.textContent));
  /** A usage-policy / rights notice; billing wording anywhere in it makes it a billing dialog instead. */
  const isUsageNotice = (dialog: Element) => !isBilling(dialog) && USAGE_NOTICE_PATTERN.test(squash(dialog.textContent));
  const enabled = (b: HTMLElement) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true';

  /**
   * Stops a step that is waiting on Flow when a dialog covers the page: a usage notice (no billing dialog) as a
   * notice the background may accept, a billing dialog as a plain stop. Unknown dialogs: the step's own wait decides.
   */
  function stopForDialog(): void {
    dismissAnnouncement(); // never a stop: Flow's "What's new" is closed and the step carries on
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
  /** The open picker's assets: the ingredients picker's Asset list, else (the frame picker) any option in the overlay. */
  const assetOptions = () => {
    const root = q(SEL.assetList) ?? q(SEL.overlay);
    return root ? [...root.querySelectorAll<HTMLElement>(SEL.assetOption)] : [];
  };
  const findAsset = (name: string) => assetOptions().find((o) => optionParts(o).some((t) => t.includes(name))) ?? null;
  const isUploading = (option: Element) => optionParts(option).some((t) => /^Uploading\b/i.test(t));
  const readyAsset = (name: string) => {
    const option = findAsset(name);
    return option && !isUploading(option) ? option : null;
  };
  const chips = () => doc.querySelectorAll(SEL.ingredientChip).length;

  /**
   * Highlights the asset with this name and answers with "Add to prompt", ready to press. Add adds whichever asset is
   * highlighted (live, 8 Nov 2026), and the list can redraw after it opens (a new upload on top and highlighted again,
   * Add disabled until then). So Add must be enabled first, and the click is repeated until this asset is the
   * highlighted one; Add is never answered while another asset is.
   */
  async function highlightForAdd(name: string, wait: number, message?: string): Promise<HTMLElement> {
    return untilOrBlocked(
      () => {
        const add = overlayButton('Add to prompt');
        const option = readyAsset(name);
        if (!add || !option) return null;
        if (option.matches(SEL.activeAsset)) return add;
        option.click(); // checked on the next look, after any redraw it set off
        return null;
      },
      wait,
      message,
    );
  }

  /** The open picker: its asset list, or (in a brand-new Flow project, which says "No assets found.") its Upload button. */
  const pickerOpen = () => q(SEL.assetList) ?? overlayButton('Upload media');

  async function openPicker(message?: string, findTrigger: () => HTMLElement | null = () => q(SEL.ingredients)): Promise<void> {
    if (pickerOpen()) return;
    const trigger = findTrigger();
    if (!trigger) throw blocked(message);
    trigger.click();
    await untilOrBlocked(pickerOpen, opts.timeoutMs ?? PICKER_TIMEOUT_MS, message);
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


  /**
   * Uploads `file` through a picker that `open` opens (the ingredients picker, or the Start slot's frame picker),
   * unless an asset with its name is there already; waits until it is ready, then closes the picker. Timeouts pause
   * with `message`.
   */
  async function uploadThroughPicker(file: File, open: () => Promise<void>, message?: string): Promise<void> {
    const pickerWait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    await open();
    // Flow fills the list a moment after the picker opens: an empty list doesn't yet mean "not uploaded".
    await untilWatching(() => assetOptions().length > 0, ASSETS_LOAD_WAIT_MS);
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
        if (!upload) throw blocked(message);
        const before = new Set(doc.querySelectorAll(SEL.fileInput));
        doc.addEventListener('click', noFileWindow, true);
        guarded = true;
        upload.click();
        const input = await untilOrBlocked(
          () => clicked ?? [...doc.querySelectorAll<HTMLInputElement>(SEL.fileInput)].filter((i) => !before.has(i)).pop(),
          pickerWait,
          message,
        );
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await untilOrBlocked(() => readyAsset(file.name), opts.timeoutMs ?? UPLOAD_TIMEOUT_MS, message);
      await closePicker();
    } finally {
      if (guarded) doc.removeEventListener('click', noFileWindow, true);
    }
  }

  async function uploadReference(file: File): Promise<string | null> {
    stopForDialog();
    await uploadThroughPicker(file, () => openPicker());
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
    (await highlightForAdd(name, wait)).click();
    await untilOrBlocked(() => chips() === 1, wait);
  }

  // ---- Clip start frame (spike S8) ---------------------------------------------
  const frameSlot = (label: 'Start' | 'End') =>
    [...doc.querySelectorAll<HTMLElement>(SEL.emptyChip)].find((b) => textNodes(b, true).includes(label)) ?? null;

  /** A picture chip in the Start position (before the swap button) while End is still an empty chip. */
  function hasStartFrame(): boolean {
    const end = frameSlot('End');
    if (!end) return false;
    const swap = q(SEL.swapFrames);
    return [...doc.querySelectorAll(SEL.startFrameChip)].some((chip) => {
      const before = swap ?? end;
      return !!(chip.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  }

  /** Start must be an empty slot to open its picker: a frame left from an earlier try goes first (Clear prompt). */
  async function emptyStartSlot(): Promise<HTMLElement> {
    const wait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    const start = frameSlot('Start');
    if (start) return start;
    if (!q(SEL.startFrameChip)) throw blocked(START_FRAME_MESSAGE); // no Start slot: Flow isn't in Video · Frames
    const clear = q(SEL.clearPrompt);
    if (!clear) throw blocked(START_FRAME_MESSAGE);
    clear.click();
    return untilOrBlocked(() => frameSlot('Start'), wait, START_FRAME_MESSAGE);
  }

  const framePickerOpen = () => !!pickerOpen() && FRAME_PICKER_TITLE.test(squash((q(SEL.overlay) ?? doc.body).textContent));

  async function openFramePicker(): Promise<void> {
    if (framePickerOpen()) return;
    // Another picker (the ingredients picker) is open: close it first, never upload or pick through it.
    if (pickerOpen()) {
      await closePicker();
      if (pickerOpen()) throw blocked(START_FRAME_MESSAGE);
    }
    (await emptyStartSlot()).click();
    await untilOrBlocked(framePickerOpen, opts.timeoutMs ?? PICKER_TIMEOUT_MS, START_FRAME_MESSAGE);
  }

  async function uploadStartFrame(file: File): Promise<void> {
    stopForDialog();
    // Only Video · Frames has a Start slot: a new Flow project can open in Image mode (live, 8 Nov 2026, after
    // Auto-pick). With no slot showing, Flow is switched (Agent mode hides the settings, so it goes off first);
    // switching settings costs nothing. A page that already shows the slot is left as it is.
    if (!frameSlot('Start') && !q(SEL.startFrameChip)) {
      try {
        await turnOffAgentMode();
        await chooseSetting('Video', () => findRadio('Video')?.getAttribute('aria-checked') === 'true');
        await chooseSetting('Frames', () => findRadio('Frames')?.getAttribute('aria-checked') === 'true');
      } catch (err) {
        if (err instanceof FlowBlockedError) throw err;
        throw blocked(START_FRAME_MESSAGE);
      }
    }
    await uploadThroughPicker(file, openFramePicker, START_FRAME_MESSAGE);
  }

  async function uploadAgentPicture(file: File): Promise<void> {
    stopForDialog();
    await uploadThroughPicker(file, () => openPicker(AGENT_ASK_MESSAGE), AGENT_ASK_MESSAGE);
  }

  async function attachStartFrame(name: string): Promise<void> {
    stopForDialog();
    const wait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    await openFramePicker();
    const option = await untilOrBlocked(() => readyAsset(name), wait, START_FRAME_MESSAGE);
    // Spike S8: this picker has no "Add to prompt": picking the asset attaches it and closes the overlay.
    option.click();
    await untilOrBlocked(hasStartFrame, wait, START_FRAME_MESSAGE);
    await closePicker();
  }

  // ---- Cost and credits (spike S8) -----------------------------------------------
  const costLabel = () => q(SEL.creditCost);
  const parseCount = (s: string) => Number(s.replace(/,/g, ''));

  async function readGenerateCost(): Promise<number | null> {
    const wait = opts.timeoutMs ?? SETTINGS_TIMEOUT_MS;
    let opened = false;
    if (!costLabel()) {
      const trigger = q(SEL.settingsTrigger);
      if (!trigger) return null;
      trigger.click();
      opened = true;
      await until(costLabel, wait, 'no cost').catch(() => null);
    }
    const m = GENERATE_COST.exec(squash(costLabel()?.textContent));
    // Leave the popover as it was: close it only when this opened it (and it is still open).
    if (opened && (costLabel() || q(SEL.radioGroup))) q(SEL.settingsTrigger)?.click();
    return m ? parseCount(m[1]!) : null;
  }

  const accountPanel = () =>
    [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].find((d) => d.querySelector(SEL.closeAccountPanel)) ?? null;

  async function closeAccountPanel(): Promise<void> {
    // Escape doesn't close it (spike S8): only its own close button does.
    accountPanel()?.querySelector<HTMLElement>(SEL.closeAccountPanel)?.click();
    await until(() => !accountPanel(), CLOSE_WAIT_MS, 'still open').catch(() => undefined);
  }

  async function readCreditBalance(): Promise<CreditBalance | null> {
    stopForDialog();
    // A brand-new Flow project draws its header a moment after it opens (live, 8 Nov 2026).
    const button = await untilWatching(() => q<HTMLElement>(SEL.accountDetails), opts.timeoutMs ?? SETTINGS_TIMEOUT_MS);
    if (!button) return null;
    try {
      button.click();
      const read = (): CreditBalance | null => {
        const panel = accountPanel();
        if (!panel) return null;
        let credits: number | null = null;
        let resets: string | null = null;
        for (const el of panel.querySelectorAll<HTMLElement>('*')) {
          if (el.children.length > 0 && el.querySelector('*:not(mat-icon)')) continue; // leaf texts only
          const text = squash(textNodes(el, true).join(' '));
          const c = CREDIT_BALANCE.exec(text);
          if (c && credits === null) credits = parseCount(c[1]!);
          const r = CREDIT_RESETS.exec(text);
          if (r && resets === null) resets = r[1]!.trim();
        }
        return credits === null ? null : { credits, resets };
      };
      return await until(read, opts.timeoutMs ?? SETTINGS_TIMEOUT_MS, 'no balance').catch(() => null);
    } finally {
      await closeAccountPanel();
    }
  }

  // ---- Clip file (spike S8) -------------------------------------------------------
  async function clipFileUrl(timeoutMs: number): Promise<ClipFile | null> {
    const perf = opts.perf ?? doc.defaultView?.performance ?? performance;
    const button = q(SEL.downloadMedia);
    if (!button) return null;
    // Entries from a PerformanceObserver arrive even when the page's resource-timing buffer is full.
    const observed: PerformanceEntry[] = [];
    const Observer = opts.perf ? undefined : doc.defaultView?.PerformanceObserver;
    let observer: PerformanceObserver | null = null;
    try {
      if (Observer) {
        observer = new Observer((list) => observed.push(...list.getEntries()));
        observer.observe({ type: 'resource' });
      }
    } catch {
      observer = null;
    }
    const since = perf.now();
    try {
      button.click();
      const item = await until(
        () =>
          [...doc.querySelectorAll<HTMLElement>(SEL.menuItem)].find((i) => {
            const text = squash(textNodes(i, true).join(' '));
            return /\b720p\b/.test(text) && /original size/i.test(text);
          }),
        opts.timeoutMs ?? PICKER_TIMEOUT_MS,
        'no 720p',
      ).catch(() => null);
      if (!item) {
        // Close the menu without choosing anything else.
        const menu = doc.querySelector(SEL.menuItem);
        menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        return null;
      }
      item.click();
      const newest = () => {
        const all = [...observed, ...perf.getEntriesByType('resource')].filter(
          (e) => e.name.startsWith(CLIP_URL_PREFIX) && e.startTime >= since,
        );
        all.sort((a, b) => b.startTime - a.startTime);
        return all[0] ?? null;
      };
      const entry = await until(newest, timeoutMs, 'no clip').catch(() => null);
      if (!entry) return null;
      const id = new URL(entry.name).pathname.slice('/video/'.length).split('/')[0] ?? '';
      return id ? { url: entry.name, mediaId: decodeURIComponent(id) } : null;
    } finally {
      observer?.disconnect();
    }
  }

  // ---- Agent questions (spike S8, Agent panel recorded live) ---------------------------
  /** The question waiting for its reply: Agent rows already in the panel before it, and the settle state. */
  let asked: { question: string; last: string; since: number; pictures: number } | null = null;
  const agentPanel = () => q(SEL.agentPanel);
  const agentRows = () => [...(agentPanel()?.querySelectorAll(SEL.agentRow) ?? [])];
  /** Quotes as typed: Flow may show ’ “ ” for ' ". */
  const plainQuotes = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  /**
   * The Agent's row answering this question: the first agent row after the last owner row that asked it. Flow keeps the
   * conversation and shows earlier questions and answers again when the panel opens (live, 8 Nov 2026), so a count of
   * rows taken before sending can't tell the new answer from an old one.
   */
  function replyRow(question: string): Element | null {
    const rows = [...(agentPanel()?.querySelectorAll(SEL.messageRow) ?? [])];
    const want = plainQuotes(question);
    let at = -1;
    rows.forEach((row, i) => {
      if (row.matches(SEL.userRow) && plainQuotes(squash(textNodes(row, true).join(' '))).includes(want)) at = i;
    });
    if (at < 0) return null;
    return rows.slice(at + 1).find((row) => row.matches(SEL.agentRow)) ?? null;
  }
  /**
   * An answer's text as the Agent wrote it. Flow draws "2. reason" as a numbered list (<ol start="2"><li>reason</li>;
   * no start is 1), whose number isn't text (live, 8 Nov 2026): a one-item list leading the answer gets it back. A list
   * of several items stays as text only, so it never reads as a pick.
   */
  function answerText(el: Element): string {
    const text = squash(textNodes(el, true).join(' '));
    const lead = [...el.childNodes].find((n) => n.nodeType !== Node.COMMENT_NODE && !(n.nodeType === Node.TEXT_NODE && !squash(n.textContent)));
    if (!(lead instanceof HTMLOListElement) || lead.querySelectorAll(':scope > li').length !== 1) return text;
    const start = Number(lead.getAttribute('start') ?? '1');
    return Number.isInteger(start) ? `${start}. ${text}` : text;
  }
  /** Pictures attached to an Agent question show as Image ingredient chips (plain Ingredient ones are counted too). */
  const agentChips = () => doc.querySelectorAll(`${SEL.ingredientChip}, ${SEL.startFrameChip}`).length;
  /** The panel's own control when the panel is open (the prompt bar moves into it), else the page's. */
  const inPanel = (sel: string) => agentPanel()?.querySelector<HTMLElement>(sel) ?? q(sel);

  async function turnOnAgentMode(): Promise<void> {
    const chip = q(SEL.agentModeChip);
    if (!chip) throw blocked(AGENT_ASK_MESSAGE);
    if (chip.getAttribute('aria-pressed') === 'true') return;
    chip.click();
    await untilOrBlocked(() => !!q(SEL.agentModeOn), opts.timeoutMs ?? SETTINGS_TIMEOUT_MS, AGENT_ASK_MESSAGE);
  }

  async function finishAgent(): Promise<boolean> {
    asked = null;
    const panelGone = async () => {
      // A new session first: Flow keeps the conversation, and the next question must start a fresh one (spike S8).
      agentPanel()?.querySelector<HTMLElement>(SEL.agentNewSession)?.click();
      agentPanel()?.querySelector<HTMLElement>(SEL.agentPanelClose)?.click();
      await until(() => !agentPanel(), CLOSE_WAIT_MS, 'still open').catch(() => undefined);
    };
    try {
      await panelGone();
      await turnOffAgentMode().catch(() => undefined);
      if (agentPanel()) await panelGone(); // turning Agent off may have kept it
    } catch {
      // Never throws: the background asks again when the run stops.
    }
    return !agentPanel() && !q(SEL.agentModeOn);
  }

  async function prepareAgentQuestion(names: string[], question: string): Promise<{ x: number; y: number }> {
    const wait = opts.timeoutMs ?? PICKER_TIMEOUT_MS;
    try {
      stopForDialog();
      // Pictures cost 0 credits: Flow is set to Image before the Agent is turned on, so even a press that somehow
      // reached Generate couldn't spend any. A leftover Agent mode goes off first (it hides the settings).
      await turnOffAgentMode();
      await chooseSetting('Image', () => findRadio('Image')?.getAttribute('aria-checked') === 'true');
      await turnOnAgentMode();
      // A fresh conversation per question, so earlier answers can't sway this one (spike S8).
      const fresh = agentPanel()?.querySelector<HTMLElement>(SEL.agentNewSession);
      if (fresh) {
        fresh.click();
        await until(() => agentRows().length === 0, CLOSE_WAIT_MS, 'not cleared').catch(() => undefined);
      }
      if (agentChips() > 0) {
        // A picture left in the prompt bar: start from an empty bar so the order is known.
        const clear = inPanel(SEL.clearPrompt);
        if (!clear) throw blocked(AGENT_ASK_MESSAGE);
        clear.click();
        await untilOrBlocked(() => agentChips() === 0, wait, AGENT_ASK_MESSAGE);
      }
      // Spike S6: option → Add to prompt, one at a time, through the panel's own picker button; an attached asset
      // leaves the list.
      for (const [i, name] of names.entries()) {
        await openPicker(AGENT_ASK_MESSAGE, () => inPanel(SEL.ingredients));
        // Every picture still to attach is listed first: a list drawn before the newest upload showed is redrawn.
        const rest = names.slice(i);
        await untilOrBlocked(() => rest.every((n) => readyAsset(n)), wait, AGENT_ASK_MESSAGE);
        (await highlightForAdd(name, wait, AGENT_ASK_MESSAGE)).click();
        await untilOrBlocked(() => agentChips() === i + 1, wait, AGENT_ASK_MESSAGE);
      }
      const at = await prepareSubmit(question, { ingredients: names.length });
      asked = { question: squash(question), last: '', since: 0, pictures: names.length };
      return at;
    } catch (err) {
      await finishAgent();
      if (err instanceof FlowBlockedError) throw err;
      throw blocked(AGENT_ASK_MESSAGE);
    }
  }

  async function readAgentReply(waitMs: number): Promise<string | null> {
    const settle = opts.settleMs ?? AGENT_SETTLE_MS;
    const probe = (): string | null => {
      const ask = asked;
      if (!ask) return null;
      // Only the row answering this question counts, and only its answer text (not Show thinking or the buttons).
      const row = replyRow(ask.question);
      const answer = row ? [...row.querySelectorAll(SEL.agentReplyText)].pop() : undefined;
      const text = answer ? answerText(answer) : '';
      // No guessing at "thinking" wording: an answer counts once its text has stayed the same for the settle time.
      if (!text || text === ask.question) {
        ask.last = '';
        return null;
      }
      if (text !== ask.last) {
        ask.last = text;
        ask.since = Date.now();
        return null;
      }
      return Date.now() - ask.since >= settle ? text : null;
    };
    if (!asked) return null;
    return untilWatching(probe, waitMs);
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

  function readCreditsResets(): string | null {
    for (const el of doc.querySelectorAll<HTMLElement>('body *')) {
      if (el.children.length > 0 || el.closest('.settings-popover, [role="menu"], [role="listbox"]')) continue;
      const m = CREDITS_RESETS.exec(squash(el.textContent));
      if (m && isShown(el)) return m[1]!.trim();
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
    readCreditsResets,
    agentModeOn: () => !!q(SEL.agentModeOn),
    dismissAnnouncement,
    announcementsClosed: () => closedAnnouncements,
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
      return prepareSubmit(prompt, submitOpts);
    },

    setVideoMode() {
      return chooseSetting('Video', () => findRadio('Video')?.getAttribute('aria-checked') === 'true');
    },

    setFramesMode() {
      return chooseSetting('Frames', () => findRadio('Frames')?.getAttribute('aria-checked') === 'true');
    },

    setClipLength(seconds) {
      return chooseSetting(`${seconds}s`, () => new RegExp(`(?:^|\\s)${seconds}s(?:\\s|$)`).test(triggerText()));
    },

    setResolution720() {
      return chooseSetting('720p', () => /(?:^|\s)720p(?:\s|$)/.test(triggerText()));
    },

    uploadStartFrame,
    uploadAgentPicture,
    attachStartFrame,
    hasStartFrame,
    readGenerateCost,
    readCreditBalance,
    accountPanelOpen: () => accountPanel() !== null,
    videoResultCards,
    readVideoDetail,
    clipFileUrl,
    prepareAgentQuestion,
    readAgentReply,
    finishAgent,
    agentQuestionPending: () => asked !== null,
    agentReady() {
      const ask = asked;
      if (!ask || !q(SEL.agentModeOn)) return false;
      const box = inPanel(SEL.promptBox);
      return !!box && squash(box.textContent) === ask.question && agentChips() === ask.pictures;
    },
  };

  async function prepareSubmit(prompt: string, submitOpts: SubmitCheck = {}): Promise<{ x: number; y: number }> {
    {
      const expected = submitOpts.ingredients ?? (submitOpts.reference ? 1 : 0);
      const box = q(SEL.promptBox);
      if (!box) throw new Error("VidFlow can't find Flow's prompt box.");
      // A prompt must never carry an Ingredient it doesn't mention: one left in the bar goes first (Clear prompt also
      // empties the text, so this comes before typing). If it can't go, the run pauses.
      if (expected === 0 && chips() > 0) {
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
      const attached = submitOpts.ingredients !== undefined ? agentChips() : chips();
      if (expected > 0 && attached !== expected) throw blocked(submitOpts.ingredients !== undefined ? AGENT_ASK_MESSAGE : undefined);
      // Nor for a clip whose start frame isn't in the Start slot.
      if (submitOpts.startFrame && !hasStartFrame()) throw blocked(START_FRAME_MESSAGE);
      return at;
    }
  }
}

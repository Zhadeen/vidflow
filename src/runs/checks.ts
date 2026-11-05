/// <reference types="chrome" />
/**
 * The Checks tab (spec §19, details 3 and 4): what VidFlow reads from its own Flow tab before a run, and the tools
 * beside it (Open Flow, Show me in Flow, Test one prompt). Facts come only from VidFlow's own Flow tab; with none open,
 * every row is "Not checked yet". Start runs these first (setStartChecks in the background).
 */
import {
  FLOW_CHECKS,
  FLOW_SHOW_ME,
  FLOW_TEST_PROMPT,
  type FlowChecksResponse,
  type ShowMeResponse,
  type TestPromptResponse,
  type ToFlowTab,
} from '../flow/messages';
import { isFlowHome, projectUrlOf } from '../flow/project';
import { getAcceptNotices, getExpectedAccount } from '../settings';
import { getMediaStore, getProject, type Project } from '../store/projects';
import {
  TEST_WHILE_RUNNING_MESSAGE,
  currentFlowTab,
  getRunState,
  openFlowTab,
  openTestFlowProject,
  whileTestingPrompt,
  type StartChecksKind,
} from './coordinator';
import { FLOW_NOT_OPEN } from './health';
import { isLive } from './run';

// The health line is pure and lives on its own, so the side panel can use it without the background's modules.
export { FLOW_NOT_OPEN, healthLine } from './health';

export type CheckId = 'account' | 'page' | 'promptBox' | 'generate' | 'agentOff' | 'settings' | 'hero' | 'credits';
export interface CheckRow {
  id: CheckId;
  label: string;
  /** null = not checked (no Flow tab, or not on a Flow project yet). */
  ok: boolean | null;
  detail: string;
  /** What to do, in plain words, when ok is false. */
  fix?: string;
}

export const NOT_CHECKED = 'Not checked yet';
export const ON_PROJECT_LATER = 'Checked when a Flow project is open';
export const FLOW_NOT_OPEN_MESSAGE = "VidFlow's Flow window isn't open. Press Open Flow, then try again.";
export const NO_ANSWER_FIX = "Wait for VidFlow's Flow window to finish loading, then try again.";
const NO_PROJECT = 'That project is no longer in VidFlow.';

const LABELS: Record<CheckId, string> = {
  account: 'Google account',
  page: 'Flow page & project',
  promptBox: 'Prompt box',
  generate: 'Generate button',
  agentOff: 'Agent mode off',
  settings: 'Flow settings',
  hero: 'Hero reference',
  credits: 'Credits',
};
const ORDER: CheckId[] = ['account', 'page', 'promptBox', 'generate', 'agentOff', 'settings', 'hero', 'credits'];

/** Rows a failing Start stops on. Settings aren't: the run sets them itself. Credits never fail (pictures cost 0). */
// Agent mode never blocks either: the run turns it off itself (controller ruling, 5 Nov 2026).
const BLOCKS_SCENES = new Set<CheckId>(['account', 'page', 'promptBox', 'generate', 'hero']);
const BLOCKS_SHEET = new Set<CheckId>(['account', 'page', 'promptBox', 'generate']);
/** How long a Flow window VidFlow just opened gets to load and draw before it is read. */
export const COLD_WAIT_MS = 20_000;
const NOT_RECOGNISED = "VidFlow doesn't recognise this Flow page";
const NO_ANSWER = "The Flow page didn't answer";

export interface ChecksDeps {
  /** VidFlow's own Flow tab if open (never opens one). */
  flowTab(): Promise<{ tabId: number; url: string } | null>;
  /** Opens (or finds) VidFlow's Flow window on Flow's home page; no Flow project is made. */
  openFlowTab(): Promise<number>;
  /** Waits (up to COLD_WAIT_MS) for a tab to finish loading. */
  waitForLoad(tabId: number): Promise<void>;
  /** Brings VidFlow's Flow tab and its window to the front. */
  focusTab(tabId: number): Promise<void>;
  /** Asks the Flow helper in the tab; undefined when it doesn't answer. */
  ask(tabId: number, message: ToFlowTab): Promise<unknown>;
  project(projectId: string): Promise<Project | undefined>;
  hasMedia(mediaId: string): Promise<boolean>;
  expectedAccount(): Promise<string>;
  acceptNotices(): Promise<boolean>;
  runLive(): boolean;
  /** Puts the tab on a fresh Flow project unless it is on one (Test one prompt); throws with a plain message. */
  openProject(tabId: number): Promise<void>;
}

const HELPER_ATTEMPTS = 15;
const HELPER_RETRY_MS = 1_000;
const helperMissing = (err: unknown) =>
  /receiving end does not exist|could not establish connection|message channel closed/i.test(
    err instanceof Error ? err.message : String(err),
  );

async function askHelper(tabId: number, message: ToFlowTab): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      // A Flow window that just opened may not have loaded the helper yet.
      if (!helperMissing(err) || attempt >= HELPER_ATTEMPTS) return undefined;
      await new Promise((r) => setTimeout(r, HELPER_RETRY_MS));
    }
  }
}

const defaultDeps: ChecksDeps = {
  flowTab: currentFlowTab,
  openFlowTab,
  async waitForLoad(tabId) {
    const deadline = Date.now() + COLD_WAIT_MS;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!tab || tab.status === 'complete') return;
      await new Promise((r) => setTimeout(r, 250));
    }
  },
  // Focusing the window is only ever for the owner's own Show me in Flow / Open Flow presses: the run path never
  // focuses VidFlow's window (frontTab in the coordinator only makes the tab active inside its own window).
  async focusTab(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  },
  ask: askHelper,
  project: getProject,
  hasMedia: async (mediaId) => !!(await getMediaStore().get(mediaId).catch(() => undefined)),
  expectedAccount: getExpectedAccount,
  acceptNotices: getAcceptNotices,
  runLive: () => isLive(getRunState()),
  openProject: openTestFlowProject,
};

let deps: ChecksDeps = defaultDeps;

/** Tests only: replace what the checks talk to. Call with {} to go back to the real ones. */
export function setChecksDepsForTests(over: Partial<ChecksDeps>): void {
  deps = { ...defaultDeps, ...over };
}

const row = (id: CheckId, ok: boolean | null, detail: string, fix?: string): CheckRow => ({
  id,
  label: LABELS[id],
  ok,
  detail,
  ...(fix && ok === false ? { fix } : {}),
});

async function projectOrThrow(projectId: string): Promise<Project> {
  const project = await deps.project(projectId);
  if (!project) throw new Error(NO_PROJECT);
  return project;
}

const hasReference = (p: Project) => !!p.character?.referenceMediaId;

/** Every row "Not checked yet" (the hero row only when the video has a reference). */
function notChecked(project: Project): CheckRow[] {
  return ORDER.filter((id) => id !== 'hero' || hasReference(project)).map((id) => row(id, null, NOT_CHECKED));
}

const picturesWord = (n: number) => `${n} picture${n === 1 ? '' : 's'}`;

/** Turns the Flow helper's read into rows. `url` is the tab's address (project page vs home). */
async function rowsFrom(read: FlowChecksResponse | undefined, url: string, project: Project): Promise<CheckRow[]> {
  const expected = await deps.expectedAccount();
  const rows: CheckRow[] = [];
  if (!read) {
    rows.push(row('account', null, NOT_CHECKED));
    rows.push(row('page', false, NO_ANSWER, NO_ANSWER_FIX));
    for (const id of ['promptBox', 'generate', 'agentOff', 'settings'] as const) rows.push(row(id, null, NOT_CHECKED));
  } else {
    // Account
    if (!read.account) {
      rows.push(row('account', false, 'Not signed in', `Sign in to Flow as ${expected} in VidFlow's Flow window.`));
    } else if (read.account.toLowerCase() !== expected.toLowerCase()) {
      rows.push(
        row(
          'account',
          false,
          `Signed in as ${read.account}`,
          `Flow is signed in to ${read.account}, but VidFlow is set to use ${expected}. Switch Flow to ${expected}.`,
        ),
      );
    } else rows.push(row('account', true, read.account));

    // Page & project
    const onProject = projectUrlOf(url) !== null;
    if (read.billingDialog) {
      rows.push(
        row(
          'page',
          false,
          'Flow is showing a billing message',
          "Read Flow's billing message in the Flow window and close it. VidFlow never accepts billing or upgrade messages.",
        ),
      );
    } else if (read.noticeDialog && !(await deps.acceptNotices())) {
      rows.push(
        row(
          'page',
          false,
          "Flow is showing its usage notice",
          "Read Flow's usage notice in the Flow window and accept it, or turn on Accept Flow's notices automatically.",
        ),
      );
    } else if (!read.page) {
      rows.push(row('page', false, NOT_RECOGNISED, "Open Flow's home page in VidFlow's Flow window."));
    } else {
      const where = onProject
        ? 'Flow project open'
        : isFlowHome(url)
          ? 'Flow home · VidFlow opens a new project when it starts'
          : 'Flow page · VidFlow opens a new project when it starts';
      rows.push(row('page', true, where));
    }

    // Prompt bar: only a Flow project page has one; on the home page these wait for the run's own project.
    const bar = onProject || read.promptBox;
    const reload = 'Reload the Flow window. If it still isn’t there, Flow may have changed its page.';
    rows.push(
      bar
        ? row('promptBox', read.promptBox, read.promptBox ? 'Found' : 'Not found', reload)
        : row('promptBox', null, ON_PROJECT_LATER),
    );
    rows.push(
      bar ? row('generate', read.generate, read.generate ? 'Found' : 'Not found', reload) : row('generate', null, ON_PROJECT_LATER),
    );
    if (!read.agentOff) {
      rows.push(row('agentOff', false, 'Agent mode is on', 'VidFlow turns it off when it starts'));
    } else rows.push(bar ? row('agentOff', true, 'Off') : row('agentOff', null, ON_PROJECT_LATER));

    // Settings, as Flow's settings button shows them.
    if (read.model === null && read.aspect === null && read.outputs === null) {
      rows.push(row('settings', null, ON_PROJECT_LATER));
    } else {
      const video = /^video\b/i.test(read.model ?? '');
      const matches = !video && read.aspect === project.aspect && read.outputs === project.outputsPerPrompt;
      const flowSays = [read.model ?? 'Unknown model', read.aspect ?? 'other shape', read.outputs ? `x${read.outputs}` : 'x?'].join(' · ');
      rows.push(
        matches
          ? row('settings', true, flowSays)
          : row(
              'settings',
              false,
              `Flow: ${flowSays} · this video: Image · ${project.aspect} · x${project.outputsPerPrompt}`,
              `VidFlow sets Flow to Image · ${project.aspect} · ${picturesWord(project.outputsPerPrompt)} when it starts. Press Test one prompt to set them now.`,
            ),
      );
    }
  }

  // Hero reference: only when the video has one.
  const mediaId = project.character?.referenceMediaId;
  if (mediaId) {
    rows.push(
      (await deps.hasMedia(mediaId))
        ? row('hero', true, 'Reference picture ready · attached to every scene')
        : row(
            'hero',
            false,
            "Reference picture missing",
            "VidFlow can't find the hero's reference picture. Add it again in the hero section, or remove it.",
          ),
    );
  }

  // Credits: pictures cost 0 on Pro (spec §16.6); a balance only when Flow shows one without opening a menu.
  rows.push(
    read
      ? row('credits', true, read.credits !== null ? `${read.credits.toLocaleString('en-GB')} credits · 0 needed for pictures` : '0 needed for pictures')
      : row('credits', null, NOT_CHECKED),
  );
  return rows;
}

/** Reads VidFlow's own Flow tab (only it) for the Checks tab. With none open: flowOpen false, every row not checked. */
export async function runChecks(projectId: string, waitMs?: number): Promise<{ flowOpen: boolean; rows: CheckRow[] }> {
  const project = await projectOrThrow(projectId);
  const tab = await deps.flowTab();
  if (!tab) return { flowOpen: false, rows: notChecked(project) };
  const read = (await deps.ask(tab.tabId, { type: FLOW_CHECKS, ...(waitMs ? { waitMs } : {}) })) as FlowChecksResponse | undefined;
  return { flowOpen: true, rows: await rowsFrom(read ?? undefined, tab.url, project) };
}

/**
 * Before every Start (coordinator.setStartChecks): opens VidFlow's Flow window if it isn't open, runs the checks, and
 * answers with the first failing row's plain fix, or null to go ahead. A model sheet run only needs the account, the
 * page and the prompt bar. Agent mode never blocks: the run turns it off itself.
 */
export async function startChecks(projectId: string, kind: StartChecksKind): Promise<string | null> {
  const cold = !(await deps.flowTab());
  if (cold) await deps.waitForLoad(await deps.openFlowTab());
  const { flowOpen, rows } = await runChecks(projectId, cold ? COLD_WAIT_MS : undefined);
  if (!flowOpen) return FLOW_NOT_OPEN_MESSAGE;
  const blocks = kind === 'sheet' ? BLOCKS_SHEET : BLOCKS_SCENES;
  // A window VidFlow has only just opened may still be drawing Flow: that isn't the owner's problem to fix. The run's
  // own New-project step checks the account and the page before anything is pressed.
  // Nothing read from such a page counts (a page that isn't drawn shows no account either); the hero still does.
  const page = rows.find((r) => r.id === 'page');
  const stillLoading = cold && page?.ok === false && (page.detail === NOT_RECOGNISED || page.detail === NO_ANSWER);
  const failing = rows.find((r) => r.ok === false && blocks.has(r.id) && (!stillLoading || r.id === 'hero'));
  return failing ? (failing.fix ?? failing.detail) : null;
}

/** Opens (or brings forward) VidFlow's Flow window on Flow's home page. No Flow project is made. */
export async function openFlow(): Promise<void> {
  const tabId = await deps.openFlowTab();
  await deps.focusTab(tabId).catch(() => undefined);
}

export const SHOW_ME_BUSY_MESSAGE = 'VidFlow is making pictures right now. Show me in Flow works when the run has finished or stopped.';
const SHOW_ME_NAMES = ['prompt box', 'Generate button', 'ingredients button'];

/** Rings the prompt box, Generate and the ingredients button in VidFlow's Flow tab for ~4 s; says which weren't there. */
export async function showMeInFlow(): Promise<{ missing: string[] }> {
  if (deps.runLive()) throw new Error(SHOW_ME_BUSY_MESSAGE);
  const tab = await deps.flowTab();
  if (!tab) throw new Error(FLOW_NOT_OPEN_MESSAGE);
  await deps.focusTab(tab.tabId).catch(() => undefined);
  const reply = (await deps.ask(tab.tabId, { type: FLOW_SHOW_ME })) as ShowMeResponse | undefined;
  return { missing: reply?.missing ?? SHOW_ME_NAMES };
}

/**
 * Sets Flow's settings for this video, types a test prompt, checks Generate is ready, then clears the prompt. Never
 * presses Generate (no picture is made). Refused while a run is live. Opens a fresh Flow project if the tab isn't on one.
 */
export async function testOnePrompt(projectId: string): Promise<{ ok: boolean; message: string }> {
  if (deps.runLive()) return { ok: false, message: TEST_WHILE_RUNNING_MESSAGE };
  const project = await projectOrThrow(projectId);
  try {
    // Held throughout, so Start can't begin a run on the tab while the test types into it.
    return await whileTestingPrompt(async () => {
      const tabId = (await deps.flowTab())?.tabId ?? (await deps.openFlowTab());
      await deps.openProject(tabId);
      const reply = (await deps.ask(tabId, {
        type: FLOW_TEST_PROMPT,
        aspect: project.aspect,
        outputs: project.outputsPerPrompt,
      })) as TestPromptResponse | undefined;
      return reply ?? { ok: false, message: `The Flow page didn't answer. ${NO_ANSWER_FIX}` };
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

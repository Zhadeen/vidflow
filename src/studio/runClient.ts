/// <reference types="chrome" />
import {
  RUN_GET,
  RUN_PAUSE,
  RUN_RESUME,
  RUN_RETRY,
  RUN_START,
  RUN_STATE,
  RUN_STOP,
  RUN_SKIP,
  RUN_FORGET,
  RUN_CHOOSE,
  RUN_HERO_SHEET,
  RUN_CHECKS,
  RUN_OPEN_FLOW,
  RUN_SHOW_ME,
  RUN_TEST_PROMPT,
  type ChecksReply,
  type ChecksToolRequest,
  type OpenFlowReply,
  type ShowMeReply,
  type TestPromptReply,
  type RunReply,
  type RunStateMessage,
  type StudioRequest,
} from '../flow/messages';
import type { RunState } from '../runs/run';

/** How the studio talks to the background coordinator. Tests pass a fake. */
export interface RunClient {
  get(): Promise<RunReply>;
  start(projectId: string): Promise<RunReply>;
  pause(): Promise<RunReply>;
  resume(): Promise<RunReply>;
  retry(projectId: string, sceneId: string): Promise<RunReply>;
  /** Ends a paused run; pictures stay. */
  stop(): Promise<RunReply>;
  /** Skips the scene being worked on now: it ends as failed "Skipped by you" and the run moves on. */
  skip(): Promise<RunReply>;
  /** This project's scenes were replaced: forget a finished run for it. */
  forget(projectId: string): Promise<RunReply>;
  /** The owner chose one of a scene's pictures; saved even while a run is live. */
  choose(projectId: string, sceneId: string, pictureId: string): Promise<RunReply>;
  /** Makes the hero's model sheet in Flow (again); refused while any run is live. */
  heroSheet(projectId: string): Promise<RunReply>;
  /** The Checks tab: reads VidFlow's own Flow tab (rows "Not checked yet" when it isn't open). */
  checks(projectId: string): Promise<ChecksReply>;
  /** Opens (or brings forward) VidFlow's Flow window; no Flow project is made. */
  openFlow(): Promise<OpenFlowReply>;
  /** Rings the prompt box, Generate and the ingredients button in Flow for a few seconds; says which it couldn't find. */
  showMe(): Promise<ShowMeReply>;
  /** Sets Flow's settings, types a test prompt, checks Generate is ready, clears it. Never presses Generate. */
  testPrompt(projectId: string): Promise<TestPromptReply>;
  /** Called on every change of the run; returns an unsubscribe. */
  subscribe(listener: (state: RunState) => void): () => void;
}

export const NO_ANSWER_MESSAGE = "VidFlow's background didn't answer. Close this tab, open VidFlow again from the toolbar, then try again.";

async function send(message: StudioRequest): Promise<RunReply> {
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as RunReply | undefined;
    return reply ?? { ok: false, reason: 'error', message: NO_ANSWER_MESSAGE };
  } catch {
    return { ok: false, reason: 'error', message: NO_ANSWER_MESSAGE };
  }
}

/** A Checks-tab request; no answer comes back as { ok: false } with the plain no-answer message. */
async function ask<T>(message: ChecksToolRequest): Promise<T | { ok: false; message: string }> {
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as T | undefined;
    return reply ?? { ok: false, message: NO_ANSWER_MESSAGE };
  } catch {
    return { ok: false, message: NO_ANSWER_MESSAGE };
  }
}

export function chromeRunClient(): RunClient {
  return {
    get: () => send({ type: RUN_GET }),
    start: (projectId) => send({ type: RUN_START, projectId }),
    pause: () => send({ type: RUN_PAUSE }),
    resume: () => send({ type: RUN_RESUME }),
    retry: (projectId, sceneId) => send({ type: RUN_RETRY, projectId, sceneId }),
    stop: () => send({ type: RUN_STOP }),
    skip: () => send({ type: RUN_SKIP }),
    forget: (projectId) => send({ type: RUN_FORGET, projectId }),
    choose: (projectId, sceneId, pictureId) => send({ type: RUN_CHOOSE, projectId, sceneId, pictureId }),
    heroSheet: (projectId) => send({ type: RUN_HERO_SHEET, projectId }),
    checks: (projectId) => ask<ChecksReply>({ type: RUN_CHECKS, projectId }),
    openFlow: () => ask<OpenFlowReply>({ type: RUN_OPEN_FLOW }),
    showMe: () => ask<ShowMeReply>({ type: RUN_SHOW_ME }),
    testPrompt: (projectId) => ask<TestPromptReply>({ type: RUN_TEST_PROMPT, projectId }),
    subscribe(listener) {
      const onMessage = (message: RunStateMessage, sender: chrome.runtime.MessageSender) => {
        if (sender.id === chrome.runtime.id && message?.type === RUN_STATE) listener(message.state);
      };
      chrome.runtime.onMessage.addListener(onMessage);
      return () => chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}

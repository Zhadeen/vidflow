/// <reference types="chrome" />
import {
  RUN_GET,
  RUN_PAUSE,
  RUN_RESUME,
  RUN_RETRY,
  RUN_START,
  RUN_STATE,
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

export function chromeRunClient(): RunClient {
  return {
    get: () => send({ type: RUN_GET }),
    start: (projectId) => send({ type: RUN_START, projectId }),
    pause: () => send({ type: RUN_PAUSE }),
    resume: () => send({ type: RUN_RESUME }),
    retry: (projectId, sceneId) => send({ type: RUN_RETRY, projectId, sceneId }),
    subscribe(listener) {
      const onMessage = (message: RunStateMessage, sender: chrome.runtime.MessageSender) => {
        if (sender.id === chrome.runtime.id && message?.type === RUN_STATE) listener(message.state);
      };
      chrome.runtime.onMessage.addListener(onMessage);
      return () => chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}

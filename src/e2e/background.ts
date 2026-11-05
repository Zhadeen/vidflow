/// <reference types="chrome" />
// DEVELOPMENT-ONLY end-to-end hook. Only reachable from `npm run build:e2e`; the normal build never imports this file.
import { createProject, getMediaStore, getProject, saveProject, type AspectRatio } from '../store/projects';
import { STYLE_PRESETS, type StyleId } from '../prompts/styles';
import { parseSceneFile } from '../scenes/parse';
import { getRunState, startRun } from '../runs/coordinator';
import { runSummary } from '../runs/run';

export const E2E_MARKER = 'vidflow-e2e';
export const E2E_START = 'e2e/start';
export const E2E_STATUS = 'e2e/status';
export const E2E_PICTURE = 'e2e/picture';

export interface E2eStart {
  type: typeof E2E_START;
  name: string;
  csv: string;
  style?: StyleId;
  aspect?: AspectRatio;
  outputsPerPrompt?: 1 | 2 | 4;
}
export interface E2eStatus {
  type: typeof E2E_STATUS;
  projectId?: string;
}
export interface E2ePicture {
  type: typeof E2E_PICTURE;
  mediaId: string;
}
export type E2eRequest = E2eStart | E2eStatus | E2ePicture;
export type E2eReply = { ok: true; data: unknown } | { ok: false; error: string };

const E2E_TYPES = new Set<string>([E2E_START, E2E_STATUS, E2E_PICTURE]);
const FLOW_HOSTS = new Set(['flow.google.com', 'labs.google']);

/** Only a content script of this extension, running in a Flow tab, may use the hook. */
export function senderAllowed(sender: { id?: string; tab?: { id?: number }; url?: string }, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.tab?.id === undefined || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && FLOW_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function start(m: E2eStart) {
  if (typeof m.name !== 'string' || !m.name.trim() || typeof m.csv !== 'string') throw new Error('start needs a name and a csv string.');
  if (m.style !== undefined && m.style !== 'custom' && !(m.style in STYLE_PRESETS)) throw new Error(`Unknown style "${m.style}".`);
  const { scenes, issues } = parseSceneFile(m.csv);
  if (scenes.length === 0) throw new Error(`No scenes found. Issues: ${JSON.stringify(issues)}`);
  const project = await createProject(m.name);
  project.scenes = scenes;
  if (m.style) project.style = m.style;
  if (m.aspect) project.aspect = m.aspect;
  if (m.outputsPerPrompt) project.outputsPerPrompt = m.outputsPerPrompt;
  await saveProject(project);
  await startRun(project.id); // the same path the studio's Start button uses
  return { projectId: project.id, sceneCount: scenes.length, issues };
}

async function status(m: E2eStatus) {
  const run = getRunState();
  const projectId = m.projectId ?? run?.projectId;
  const project = projectId ? await getProject(projectId) : undefined;
  const states = run && run.projectId === projectId ? run.sceneStates : (project?.sceneStates ?? {});
  const scenes = (project?.scenes ?? []).map((s) => {
    const st = states[s.id] ?? project?.sceneStates[s.id];
    return {
      sceneId: s.id,
      status: st?.status ?? 'pending',
      message: st?.message,
      pictureCount: st?.pictureIds.length ?? 0,
      pictureIds: st?.pictureIds ?? [],
    };
  });
  return { run, runSummary: run ? runSummary(run) : null, projectId: projectId ?? null, scenes };
}

async function picture(m: E2ePicture) {
  if (typeof m.mediaId !== 'string') throw new Error('picture needs a mediaId.');
  const blob = await getMediaStore().get(m.mediaId);
  if (!blob) throw new Error(`No stored picture "${m.mediaId}".`);
  return { mediaId: m.mediaId, dataUrl: await blobToDataUrl(blob) };
}

export async function handleE2e(message: E2eRequest): Promise<E2eReply> {
  try {
    switch (message.type) {
      case E2E_START:
        return { ok: true, data: await start(message) };
      case E2E_STATUS:
        return { ok: true, data: await status(message) };
      case E2E_PICTURE:
        return { ok: true, data: await picture(message) };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface MessageEvents {
  addListener(
    cb: (message: { type?: string }, sender: chrome.runtime.MessageSender, sendResponse: (r: E2eReply) => void) => boolean | undefined,
  ): void;
}

/** Registers the hook's listener, but only when `enabled` (the e2e build). Returns whether it did. */
export function registerE2e(enabled: boolean, events: MessageEvents, extensionId: string, handle = handleE2e): boolean {
  if (!enabled) return false;
  events.addListener((message, sender, sendResponse) => {
    if (!message || !E2E_TYPES.has(message.type ?? '')) return;
    if (!senderAllowed(sender, extensionId)) {
      sendResponse({ ok: false, error: 'Not allowed: the e2e hook only answers VidFlow content scripts in a Flow tab.' });
      return;
    }
    void handle(message as E2eRequest).then(sendResponse);
    return true;
  });
  return true;
}

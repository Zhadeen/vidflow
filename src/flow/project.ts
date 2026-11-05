/** Spec §16.5: each run works in its own fresh Flow project; later scenes of the same run reuse it. */
const HOME = /^https:\/\/flow\.google\.com(?:\/u\/\d+)?\/?(?:[?#].*)?$/;
const PROJECT = /^(https:\/\/flow\.google\.com(?:\/u\/\d+)?\/project\/[^/?#]+)/;

export const isFlowHome = (url: string | undefined): boolean => !!url && HOME.test(url);

export const projectUrlOf = (url: string | undefined): string | null => (url ? PROJECT.exec(url)?.[1] ?? null : null);

export type FlowProjectAction =
  | { kind: 'ok' }
  | { kind: 'navigate'; url: string }
  | { kind: 'create'; goHome: boolean };

/** What the Flow tab must do before a scene is submitted, given the run's project (if any) and the tab's URL. */
export function flowProjectAction(runProjectUrl: string | undefined, tabUrl: string | undefined): FlowProjectAction {
  if (runProjectUrl) {
    // Only the project page itself has the prompt bar; a picture-detail page (/edit/…) counts as wandered.
    return tabUrl !== undefined && tabUrl.split(/[?#]/)[0]!.replace(/\/$/, '') === runProjectUrl
      ? { kind: 'ok' }
      : { kind: 'navigate', url: runProjectUrl };
  }
  return { kind: 'create', goHome: !isFlowHome(tabUrl) };
}

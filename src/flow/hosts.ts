/** Google Flow's pages (both hosts it is served from). One rule for the coordinator and the toolbar button. */
export function isFlowUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('https://flow.google.com/') || url.startsWith('https://labs.google/'));
}

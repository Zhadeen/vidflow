/** Google Flow's pages (both hosts it is served from). One rule for the coordinator and the toolbar button. */
export function isFlowUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('https://flow.google.com/') || url.startsWith('https://labs.google/'));
}

/**
 * Flow itself (not other Google Labs tools such as Whisk): flow.google.com, or Flow's labs.google path
 * (/fx/tools/flow, with or without a locale). Used for the toolbar's side panel; the coordinator keeps isFlowUrl.
 */
const FLOW_PAGE = /^https:\/\/(?:flow\.google\.com\/|labs\.google\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?tools\/flow(?:[/?#]|$))/;
export function isFlowPage(url: string | undefined): boolean {
  return !!url && FLOW_PAGE.test(url);
}

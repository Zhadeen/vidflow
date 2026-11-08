/** Flow page selectors, from spike S5 (docs/superpowers/spikes/s5-flow-tracking.md). Roles and aria-labels only. */
export const SEL = {
  promptBox: '[role="textbox"][aria-label="What do you want to create?"]',
  generate: '[aria-label="Start generation"]',
  settingsTrigger: '[aria-label="Settings trigger"]',
  radioGroup: '[role="radiogroup"]',
  radio: '[role="radio"]',
  ingredients: '[aria-label="Add ingredients to the prompt box"]',
  account: '[aria-label^="Google Account:"]',
  tileList: '.cdk-virtual-scroll-content-wrapper',
  tile: 'flow-grid-tile-container',
  tileImage: 'img[data-media-id]',
  promptBar: 'flow-base-prompt-box',
  /** Picture detail page (/project/<p>/edit/<id>), checked live: each history step and its full prompt text. */
  detailStep: '.editor-history-content div.history-step, div.history-step',
  detailPromptText: 'flow-expandable-prompt div.prompt-text span.text-part',
  mediaId: '[data-media-id]',
  /** The ingredients picker, from spike S7 (docs/superpowers/spikes/s7-flow-ingredient-upload.md); opened by `ingredients`. */
  overlay: '.cdk-overlay-container',
  assetList: '[role="listbox"][aria-label="Asset list"]',
  assetOption: '[role="option"]',
  /** The highlighted asset: "Add to prompt" adds this one, not the last one clicked (live, 8 Nov 2026). */
  activeAsset: '.asset-item-active',
  /** Flow appends this to <body> when "Upload media" is pressed, and keeps it there. */
  fileInput: 'body > input[type="file"]',
  /** One per ingredient attached to the prompt. */
  ingredientChip: 'button.chip-container[aria-label="Ingredient"]',
  clearPrompt: 'button[aria-label="Clear prompt"]',
  /** Flow's Agent chip while Agent mode is on: prompts then go to the Agent instead of making pictures. */
  agentModeOn: '.agent-mode-chip[aria-pressed="true"]',
  /** Spike S8, Video · Frames: the Start / End slots are empty chips until a frame is attached to them. */
  emptyChip: 'button.empty-chip',
  swapFrames: '[aria-label="Swap first and last frames"]',
  /** A frame attached to Start (or End): an image chip, unlike the hero reference's plain "Ingredient" chip. */
  startFrameChip: 'button.chip-container[aria-label="Image ingredient"]',
  /** In the settings popover: "Generating will use N credits". */
  creditCost: '.credit-cost-label',
  /** Spike S8: the Account details panel (project grid page only); only its close button closes it. */
  accountDetails: '[aria-label="Account details"]',
  closeAccountPanel: '[aria-label="Close account panel"]',
  /** A finished clip's grid tile (no data-media-id), inside its flow-tile-container with the caption. */
  videoTile: 'flow-video-tile',
  videoTileContainer: 'flow-tile-container',
  /** On a clip's page: opens a menu of role="menuitem" download choices. */
  downloadMedia: '[aria-label="Download media"]',
  menuItem: '[role="menuitem"]',
  agentModeChip: '.agent-mode-chip',
  /**
   * Flow's Agent chat panel, recorded live (spike S8, "Agent panel"): the Agent's answers are .agent-row message rows
   * with the text in .markdown-container; header buttons Start new session and Close. While the panel is open the
   * prompt bar (prompt box, Add ingredients, Start generation) sits inside it, and pictures show as Image ingredient chips.
   */
  agentPanel: 'flow-agent-panel',
  agentRow: '.message-row.agent-row',
  agentReplyText: '.markdown-container',
  agentNewSession: '[aria-label="Start new session"]',
  agentPanelClose: '[aria-label="Close"]',
  dialog: '[role="dialog"], [role="alertdialog"], dialog[open], mat-dialog-container',
  notice: '[role="alert"], [role="status"], [aria-live], mat-snack-bar-container, .mat-mdc-snack-bar-container',
} as const;

/** Spike S8: the signed URL Flow fetches a clip's file from ("720p Original size"); the path segment is the media id. */
export const CLIP_URL_PREFIX = 'https://flow-content.google/video/';

/** Trigger-text icon Flow shows for each aspect ratio. */
export const ASPECT_ICON = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '1:1': 'crop_square' } as const;

// Flow's limit/refusal wording was not seen in spike S5; these are Flow Flash's patterns. Unknown notices are logged.
export const LIMIT_PATTERN = /rate limit|quota|daily limit|limit reached|reached your limit|try again later|out of credits|not enough credits|run out of credits/i;
export const REFUSAL_PATTERN = /content polic|might violate|violat(?:es|ed|ion)|couldn't generate|could not generate|unable to generate|safety (?:filter|guideline|reason|polic)/i;
/**
 * Flow's usage-policy / rights notices: the only dialogs VidFlow may accept itself (switch "Accept Flow's notices
 * automatically"). Known wording: "necessary rights", "Prohibited Use Policy". Kept narrow on purpose.
 */
export const USAGE_NOTICE_PATTERN = /usage polic(?:y|ies)|use policy|prohibited use|necessary rights/i;
/** Billing / payment / upgrade dialogs: never accepted or pressed; the run stops with a plain message. Wins over a notice. */
export const BILLING_PATTERN = /paid tier|billing|payment|upgrade|subscribe/i;
/** The accept button of a usage notice: its whole label, so "OK", "Edit prompt" or "Confirm" never match. */
export const NOTICE_ACCEPT_PATTERN = /^\s*(?:i understand|i agree|agree|accept|agree and continue|continue)\s*$/i;
/** Flow's "What's new" announcements (spike S8): closed with "Get started"; never a notice or a billing dialog. */
export const ANNOUNCEMENT_CLOSE_PATTERN = /^\s*get started\s*$/i;
export const ANNOUNCEMENT_MORE_PATTERN = /^\s*view all changelogs\s*$/i;
export const PROGRESS_PATTERN = /\b(\d{1,3})\s?%/;

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
  /** Flow appends this to <body> when "Upload media" is pressed, and keeps it there. */
  fileInput: 'body > input[type="file"]',
  /** One per ingredient attached to the prompt. */
  ingredientChip: 'button.chip-container[aria-label="Ingredient"]',
  clearPrompt: 'button[aria-label="Clear prompt"]',
  /** Flow's Agent chip while Agent mode is on: prompts then go to the Agent instead of making pictures. */
  agentModeOn: '.agent-mode-chip[aria-pressed="true"]',
  dialog: '[role="dialog"], [role="alertdialog"], dialog[open], mat-dialog-container',
  notice: '[role="alert"], [role="status"], [aria-live], mat-snack-bar-container, .mat-mdc-snack-bar-container',
} as const;

/** Trigger-text icon Flow shows for each aspect ratio. */
export const ASPECT_ICON = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '1:1': 'crop_square' } as const;

// Flow's limit/refusal wording was not seen in spike S5; these are Flow Flash's patterns. Unknown notices are logged.
export const LIMIT_PATTERN = /rate limit|quota|daily limit|limit reached|reached your limit|try again later|out of credits|not enough credits|run out of credits/i;
export const REFUSAL_PATTERN = /content polic|might violate|violat(?:es|ed|ion)|couldn't generate|could not generate|unable to generate|safety (?:filter|guideline|reason|polic)/i;
export const POLICY_DIALOG_PATTERN = /usage polic|use policy|paid tier|billing/i;
export const PROGRESS_PATTERN = /\b(\d{1,3})\s?%/;

export type StyleId = 'stickman-whiteboard' | 'stickman-doodle-comic' | 'stickman-colour' | 'custom';

export interface StylePreset {
  id: StyleId;
  name: string;
  prefix: string;
  enforcement: string;
  forbiddenWords: string[];
  /** Optional style-specific wording for the hero character line. */
  characterHint?: string;
}

const FORBIDDEN = ['photorealistic', 'realistic', '3D', 'CGI', 'render'];

export const STYLE_PRESETS: Record<Exclude<StyleId, 'custom'>, StylePreset> = {
  'stickman-whiteboard': {
    id: 'stickman-whiteboard',
    name: 'Classic whiteboard stickman',
    prefix:
      'Classic whiteboard explainer drawing: simple black ink stick figures with round heads, thin line limbs and minimal facial marks, drawn with a marker on a clean plain white background, lots of empty space.',
    enforcement:
      'Style: flat 2D black marker lines on white only, no shading, no gradients, no depth, no colour fills.',
    forbiddenWords: FORBIDDEN,
    characterHint: 'drawn as a stick figure',
  },
  'stickman-doodle-comic': {
    id: 'stickman-doodle-comic',
    name: 'Doodle comic stickman',
    prefix:
      'Hand-drawn doodle comic panel: wobbly pen-and-ink stick figures with expressive round heads, sketchy outlines, small speech-bubble style marks and doodled props, on light cream paper with a loose notebook feel.',
    enforcement:
      'Style: flat 2D hand-drawn ink doodle lines on paper only, no shading, no depth, no polished digital finish.',
    forbiddenWords: FORBIDDEN,
    characterHint: 'drawn as a stick figure',
  },
  'stickman-colour': {
    id: 'stickman-colour',
    name: 'Coloured stickman',
    prefix:
      'Simple colourful explainer illustration: stick figures with round heads and thin dark outlines, objects and backgrounds filled with bright flat colour blocks, clean uncluttered composition.',
    enforcement:
      'Style: flat 2D vector-like shapes with solid flat colour fills only, no shading, no gradients, no depth.',
    forbiddenWords: FORBIDDEN,
    characterHint: 'drawn as a stick figure',
  },
};

export function customStyle(text: string): StylePreset {
  return { id: 'custom', name: 'Custom', prefix: text, enforcement: '', forbiddenWords: [] };
}

import { describe, it, expect } from 'vitest';
import { buildImagePrompt } from '../../src/prompts/build';
import { STYLE_PRESETS, customStyle } from '../../src/prompts/styles';
import type { Scene } from '../../src/scenes/types';

const scene: Scene = {
  id: 'scene-01', slide: 1, start: 0, end: 4, sentence: 's', concept: 'c', textOverlay: '',
  imagePrompt: 'A stickman stares at a pile of bills', motionPrompt: 'm', motionPromptIsDefault: false,
};
const hero = { description: 'tall stickman with a red scarf', hasReferenceImage: false };

describe('buildImagePrompt', () => {
  it('orders style, character, scene, enforcement', () => {
    for (const style of Object.values(STYLE_PRESETS)) {
      const out = buildImagePrompt(scene, style, hero);
      const idx = [style.prefix, 'HERO', 'red scarf', `Scene: ${scene.imagePrompt}`, style.enforcement].map((s) => out.indexOf(s));
      expect(idx.every((i) => i >= 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it('omits the character block when none', () => {
    expect(buildImagePrompt(scene, STYLE_PRESETS['stickman-whiteboard'], null)).not.toMatch(/HERO/);
  });

  it('mentions the Ingredient reference only when one is attached', () => {
    const s = STYLE_PRESETS['stickman-colour'];
    expect(buildImagePrompt(scene, s, { ...hero, hasReferenceImage: true })).toMatch(/reference picture.*Ingredient/i);
    expect(buildImagePrompt(scene, s, hero)).not.toMatch(/Ingredient/);
  });

  it('removes words that fight the style', () => {
    for (const style of Object.values(STYLE_PRESETS)) {
      const out = buildImagePrompt(scene, style, { description: 'natural photorealistic facial features', hasReferenceImage: false });
      expect(out).not.toMatch(/photorealistic|realistic skin|3D/i);
      expect(out).toMatch(/natural facial features/);
    }
  });

  it('keeps preset text free of forbidden words', () => {
    for (const style of Object.values(STYLE_PRESETS)) {
      for (const w of style.forbiddenWords) {
        const re = new RegExp(`\\b${w}\\b`, 'i');
        expect(style.prefix).not.toMatch(re);
        expect(style.enforcement).not.toMatch(re);
      }
    }
  });

  it('never writes aspect ratio into the prompt', () => {
    for (const style of Object.values(STYLE_PRESETS)) {
      expect(buildImagePrompt(scene, style, hero)).not.toMatch(/aspect ratio|16:9|9:16/i);
    }
  });
});

describe('character block is style-aware', () => {
  it('only says stick figure for presets that carry a characterHint', () => {
    expect(buildImagePrompt(scene, customStyle('chalk on slate'), hero)).not.toMatch(/stick figure/i);
    expect(buildImagePrompt(scene, STYLE_PRESETS['stickman-doodle-comic'], hero)).toMatch(/stick figure/i);
  });
});

describe('forbidden word stripping', () => {
  const cases = [
    'photo-realistic face', 'hyper-realistic skin', 'photorealism look', 'realistically shaded',
    'rendered in 3D-rendered style', 'glossy renders', 'CGI-style hands', 'Photorealistic, 3D, CGI.',
    'tall man with a hat.',
  ];
  it.each(cases)('cleans %s', (description) => {
    for (const style of Object.values(STYLE_PRESETS)) {
      const out = buildImagePrompt(scene, style, { description, hasReferenceImage: false });
      const hero = out.split('\n\n').find((b) => b.startsWith('HERO')) ?? '';
      expect(hero).not.toMatch(/realis|render|3D|CGI|photo|hyper/i);
      expect(hero).not.toMatch(/\.\.|-\s|\s-|,\s*,|\s,/);
    }
  });
  it('drops the description sentence when nothing is left', () => {
    const out = buildImagePrompt(scene, STYLE_PRESETS['stickman-colour'], { description: 'photorealistic 3D', hasReferenceImage: false });
    expect(out).not.toMatch(/:\s*\./);
  });
});

describe('customStyle', () => {
  it('uses the text as prefix with no enforcement', () => {
    const s = customStyle('chalk on slate');
    expect(s).toMatchObject({ id: 'custom', prefix: 'chalk on slate', enforcement: '', forbiddenWords: [] });
    expect(buildImagePrompt(scene, s, null)).toBe('chalk on slate\n\nScene: A stickman stares at a pile of bills');
  });
});

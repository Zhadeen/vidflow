import type { Scene } from '../scenes/types';
import type { StylePreset } from './styles';

export interface CharacterSpec {
  description: string;
  /** The owner's reference picture in the media store (`hero-reference`); stored projects without it have none. */
  referenceMediaId?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stem(word: string): string {
  return word.length > 6 && word.endsWith('istic') ? word.slice(0, -3) : word;
}

function stripForbidden(text: string, words: string[]): string {
  let out = text;
  for (const w of words) {
    const re = new RegExp(
      `(?<![\\w])(?:(?:photo|hyper|ultra|semi)-?)?${escapeRe(stem(w))}\\w*(?:-\\w+)*(?![\\w])`,
      'gi',
    );
    out = out.replace(re, ' ');
  }
  return out
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])(\s*[,;])+/g, '$1')
    .replace(/^[\s,;.-]+|[\s,;.-]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

function characterBlock(character: CharacterSpec, style: StylePreset): string {
  const desc = stripForbidden(character.description, style.forbiddenWords).replace(/[.\s]+$/, '');
  const hint = style.characterHint ? `, ${style.characterHint}` : '';
  let block = `HERO character (keep identical in every scene${hint})`;
  block += desc ? `: ${desc}.` : '.';
  if (character.referenceMediaId) block += ' Match the reference picture attached in the Ingredient slot exactly.';
  return block;
}

export function buildImagePrompt(scene: Scene, style: StylePreset, character: CharacterSpec | null): string {
  const parts = [style.prefix];
  if (character) parts.push(characterBlock(character, style));
  parts.push(`Scene: ${scene.imagePrompt}`);
  if (style.enforcement) parts.push(style.enforcement);
  return parts.join('\n\n');
}

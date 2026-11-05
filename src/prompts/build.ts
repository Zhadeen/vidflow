import type { Scene } from '../scenes/types';
import type { StylePreset } from './styles';

export interface CharacterSpec {
  description: string;
  hasReferenceImage: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripForbidden(text: string, words: string[]): string {
  let out = text;
  for (const w of words) {
    out = out.replace(new RegExp(`(?<![\\w])${escapeRe(w)}(?![\\w])`, 'gi'), ' ');
  }
  return out
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])(\s*[,;])+/g, '$1')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

function characterBlock(character: CharacterSpec, style: StylePreset): string {
  const desc = stripForbidden(character.description, style.forbiddenWords);
  const ref = character.hasReferenceImage
    ? ' Match the reference picture attached in the Ingredient slot exactly.'
    : '';
  return `HERO character (keep identical in every scene, drawn as a stick figure): ${desc}.${ref}`;
}

export function buildImagePrompt(scene: Scene, style: StylePreset, character: CharacterSpec | null): string {
  const parts = [style.prefix];
  if (character) parts.push(characterBlock(character, style));
  parts.push(`Scene: ${scene.imagePrompt}`);
  if (style.enforcement) parts.push(style.enforcement);
  return parts.join('\n\n');
}

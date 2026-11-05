const PREFIX = 'Gentle, natural movement: ';
const MAX_LENGTH = 200;

export function defaultMotionPrompt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return (PREFIX + clean).slice(0, MAX_LENGTH).trimEnd();
}

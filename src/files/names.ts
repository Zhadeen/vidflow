import type { Scene } from '../scenes/types';
import type { NamingFormat } from '../settings';

/** The picture types Flow returns, as file extensions. */
export type PictureExt = 'png' | 'jpg' | 'webp';

/** A picture's extension from its type: image/jpeg → jpg, image/webp → webp, anything else → png. */
export function extFor(type: string): PictureExt {
  const t = type.toLowerCase();
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg';
  if (t === 'image/webp') return 'webp';
  return 'png';
}

const two = (n: number) => String(n).padStart(2, '0');
const whole = (seconds: number) => Math.max(0, Math.floor(seconds));
/** 65 → "01m05s" */
const minSec = (s: number) => `${two(Math.floor(whole(s) / 60))}m${two(whole(s) % 60)}s`;
/** 65 → "01-05" */
const dashed = (s: number) => `${two(Math.floor(whole(s) / 60))}-${two(whole(s) % 60)}`;

/**
 * The file name of one of a scene's pictures (spec §19, settled detail 6): slide number and the scene's own timecode in
 * the chosen format; no timecode → "Slide_01". "Both options": the chosen picture has the plain name and the others
 * "_option2" (then "_option3", "_option4" when Flow made four).
 */
export function fileName(scene: Scene, format: NamingFormat, option: 'chosen' | 'other', ext: PictureExt, otherNumber = 2): string {
  const slide = `Slide_${two(scene.slide)}`;
  const { start, end } = scene;
  let base = slide;
  if (start !== null && end !== null) {
    if (format === 'slide-time') base = `${slide}_${minSec(start)}-${minSec(end)}`;
    else if (format === 'slide-timecode') base = `${slide}_${dashed(start)}_to_${dashed(end)}`;
    else if (format === 'slide-seconds') base = `${slide}_${two(whole(start))}s-${two(whole(end))}s`;
    else if (format === 'time-slide') base = `${minSec(start)}-${minSec(end)}_${slide}`;
  }
  return `${base}${option === 'other' ? `_option${otherNumber}` : ''}.${ext}`;
}

/**
 * A name made safe as a folder or file name under Downloads: / \ : * ? " < > | and control characters removed, spaces
 * collapsed, trimmed; leading and trailing dots dropped (Chrome refuses "." and ".." parts). Empty → "VidFlow".
 */
export function folderName(name: string): string {
  const safe = name
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return safe || 'VidFlow';
}

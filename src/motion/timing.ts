import type { Scene } from '../scenes/types';

export type ClipLength = 4 | 6 | 8 | 10;
/** A clip VidFlow made for a slide: the Flow media id, the picture it was made from, its measured length, the part used. */
export interface ClipRecord {
  mediaId: string;
  sourcePictureId: string;
  length: number;
  use: [number, number];
  /** Flow's own id of the clip (from its file address): one Flow clip is never saved for two slides. */
  flowMediaId?: string;
}

const MISSING_SECONDS = 3;
const LENGTHS: ClipLength[] = [4, 6, 8, 10];
export const CLIP_COST: Record<ClipLength, number> = { 4: 7, 6: 10, 8: 12, 10: 15 };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** How long the slide is on screen; a missing or invalid timecode counts 3 s. */
export function slideSeconds(scene: Scene): number {
  const { start, end } = scene;
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) return MISSING_SECONDS;
  const s = end - start;
  return s > 0 ? s : MISSING_SECONDS;
}

/** The shortest clip length (4/6/8/10) that covers the slide; longer slides cap at 10. */
export function clipLengthFor(seconds: number): ClipLength {
  const s = round3(seconds);
  return LENGTHS.find((l) => s <= l) ?? 10;
}

/** The part of the clip the slide uses, in seconds: [0, min(slide, clip length)]. */
export function useRange(seconds: number, length: number): [number, number] {
  return [0, round3(Math.min(seconds, length))];
}

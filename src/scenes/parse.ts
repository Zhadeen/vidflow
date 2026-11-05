import Papa from 'papaparse';
import { defaultMotionPrompt } from './motion';
import type { ParseIssue, ParseResult, Scene } from './types';

type Field =
  | 'slide'
  | 'timecode'
  | 'sentence'
  | 'concept'
  | 'textOverlay'
  | 'imagePrompt'
  | 'motionPrompt';

const HEADER_FIELDS: Record<string, Field> = {
  slide: 'slide',
  timecode: 'timecode',
  sentence: 'sentence',
  concept: 'concept',
  'text overlay': 'textOverlay',
  overlay: 'textOverlay',
  'image prompt': 'imagePrompt',
  prompt: 'imagePrompt',
  'motion prompt': 'motionPrompt',
};

function toSeconds(part: string): number | null {
  const p = part.trim().toLowerCase();
  const secs = /^(\d+(?:\.\d+)?)\s*s?$/.exec(p);
  if (secs) return Number(secs[1]);
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(p);
  if (!clock) return null;
  return clock[3] !== undefined
    ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    : Number(clock[1]) * 60 + Number(clock[2]);
}

export function parseTimecode(s: string): { start: number; end: number } | null {
  const parts = s.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return null;
  const start = toSeconds(parts[0]);
  const end = toSeconds(parts[1]);
  return start === null || end === null ? null : { start, end };
}

function sceneId(slide: number): string {
  return `scene-${slide < 100 ? String(slide).padStart(2, '0') : slide}`;
}

/** Remove a ```csv fence (and any chatter around it); returns the body and its first line number. */
function stripFence(text: string): { lines: string[]; firstLine: number } {
  const all = text.replace(/^﻿/, '').split(/\r?\n/);
  const open = all.findIndex((l) => /^\s*```/.test(l));
  if (open === -1) return { lines: all, firstLine: 1 };
  const close = all.findIndex((l, i) => i > open && /^\s*```\s*$/.test(l));
  return {
    lines: all.slice(open + 1, close === -1 ? undefined : close),
    firstLine: open + 2,
  };
}

function buildScene(
  slide: number,
  f: Partial<Record<Field, string>>,
  lineNo: number,
  issues: ParseIssue[],
): Scene {
  const sentence = (f.sentence ?? '').trim();
  const imagePrompt = (f.imagePrompt ?? '').trim();
  const given = (f.motionPrompt ?? '').trim();
  const time = f.timecode ? parseTimecode(f.timecode) : null;
  if (!imagePrompt) issues.push({ line: lineNo, message: `Scene ${slide} has no image prompt.` });
  return {
    id: sceneId(slide),
    slide,
    start: time ? time.start : null,
    end: time ? time.end : null,
    sentence,
    concept: (f.concept ?? '').trim(),
    textOverlay: (f.textOverlay ?? '').trim(),
    imagePrompt,
    motionPrompt: given || defaultMotionPrompt(sentence || imagePrompt),
    motionPromptIsDefault: !given,
  };
}

function parseCsv(lines: string[], firstLine: number, headerIdx: number): ParseResult {
  const scenes: Scene[] = [];
  const issues: ParseIssue[] = [];
  const whole = Papa.parse<string[]>(lines.join('\n'), { skipEmptyLines: false, delimiter: ',' });
  let rows = whole.data;
  if (whole.errors.some((e) => e.type === 'Quotes')) {
    // An unclosed quote swallows every later row; read line by line so none are lost.
    rows = lines.map((line, i) => {
      const one = Papa.parse<string[]>(line, { delimiter: ',' });
      if (i > headerIdx && one.errors.some((e) => e.type === 'Quotes')) {
        issues.push({
          line: firstLine + i,
          message: `Line ${firstLine + i} has a quote that is never closed, so its columns may be wrong.`,
        });
      }
      return one.data[0] ?? [''];
    });
  }
  const columns = rows[headerIdx].map((h) => HEADER_FIELDS[h.trim().toLowerCase()]);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => c.trim() === '')) continue;
    const fields: Partial<Record<Field, string>> = {};
    columns.forEach((field, c) => {
      if (field && row[c] !== undefined) fields[field] = row[c];
    });
    const n = /\d+/.exec(fields.slide ?? '');
    const slide = n ? Number(n[0]) : scenes.length + 1;
    scenes.push(buildScene(slide, fields, firstLine + i, issues));
  }
  return { scenes, issues };
}

function parsePlain(lines: string[], firstLine: number): ParseResult {
  const scenes: Scene[] = [];
  const issues: ParseIssue[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const numbered = /^(\d+)\s*[.):-]\s*(.*)$/.exec(line);
    const slide = numbered ? Number(numbered[1]) : scenes.length + 1;
    scenes.push(buildScene(slide, { imagePrompt: numbered ? numbered[2] : line }, firstLine + i, issues));
  });
  return { scenes, issues };
}

function isCsvHeader(line: string): boolean {
  const cells = Papa.parse<string[]>(line, { delimiter: ',' }).data[0] ?? [];
  return cells.some((c) => HEADER_FIELDS[c.trim().toLowerCase()] === 'imagePrompt');
}

export function parseSceneFile(text: string): ParseResult {
  const { lines, firstLine } = stripFence(text);
  const headerIdx = lines.findIndex((l) => l.trim() !== '');
  if (headerIdx !== -1 && isCsvHeader(lines[headerIdx])) {
    return parseCsv(lines, firstLine, headerIdx);
  }
  return parsePlain(lines, firstLine);
}

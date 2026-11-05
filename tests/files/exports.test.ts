import { describe, expect, it } from 'vitest';
import { slideListCsv, timingJson } from '../../src/files/exports';
import type { Project } from '../../src/store/projects';
import type { Scene } from '../../src/scenes/types';

const scene = (i: number, over: Partial<Scene> = {}): Scene => ({
  id: `scene-0${i}`,
  slide: i,
  start: (i - 1) * 4,
  end: i * 4,
  sentence: `Line ${i}.`,
  concept: '',
  textOverlay: '',
  imagePrompt: '',
  motionPrompt: '',
  motionPromptIsDefault: true,
  ...over,
});

function project(): Project {
  return {
    id: 'p1',
    name: 'Phone Bill Story',
    createdAt: 0,
    updatedAt: 0,
    scenes: [
      scene(1, { sentence: 'Every month, my "phone" bill went up.' }),
      scene(2, { sentence: 'Two\nlines.' }),
      scene(3, { start: null, end: null }),
      scene(4, { start: 65, end: 68 }),
    ],
    style: 'stickman-whiteboard',
    character: null,
    aspect: '16:9',
    outputsPerPrompt: 2,
    sceneStates: {
      'scene-01': { sceneId: 'scene-01', status: 'done', pictureIds: ['p1/scene-01-option-1', 'p1/scene-01-option-2'], chosenPictureId: 'p1/scene-01-option-2' },
      'scene-02': { sceneId: 'scene-02', status: 'done', pictureIds: ['p1/scene-02-option-1'] },
      'scene-03': { sceneId: 'scene-03', status: 'failed', message: 'x', pictureIds: [] },
    },
    downloaded: { 'p1/scene-01-option-2': 'Slide_01_00m00s-00m04s.png' },
  };
}

describe('exports', () => {
  it('slide list CSV: slide, timecode, sentence, status and file, RFC 4180 quoted', () => {
    const csv = slideListCsv(project(), { 'scene-02': 'Slide_02_00m04s-00m08s.jpg' });
    expect(csv.split('\r\n')).toEqual([
      'Slide,Timecode,Sentence,Status,File',
      '1,00:00 - 00:04,"Every month, my ""phone"" bill went up.",Saved,Slide_01_00m00s-00m04s.png',
      '2,00:04 - 00:08,"Two\nlines.",Saved,Slide_02_00m04s-00m08s.jpg',
      '3,,Line 3.,Failed,',
      '4,01:05 - 01:08,Line 4.,To go,',
    ]);
  });

  it('without file names given, the CSV names only what was downloaded', () => {
    const lines = slideListCsv(project()).split('\r\n');
    expect(lines[1]!.endsWith(',Saved,Slide_01_00m00s-00m04s.png')).toBe(true);
    expect(lines[2]!.endsWith(',Saved,')).toBe(true);
  });

  it('timing file: JSON of slide, start, end, sentence and file', () => {
    const json = JSON.parse(timingJson(project(), { 'scene-02': 'Slide_02_00m04s-00m08s.jpg' }));
    expect(json).toEqual([
      { slide: 1, start: 0, end: 4, sentence: 'Every month, my "phone" bill went up.', file: 'Slide_01_00m00s-00m04s.png' },
      { slide: 2, start: 4, end: 8, sentence: 'Two\nlines.', file: 'Slide_02_00m04s-00m08s.jpg' },
      { slide: 3, start: null, end: null, sentence: 'Line 3.', file: null },
      { slide: 4, start: 65, end: 68, sentence: 'Line 4.', file: null },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { extFor, fileName, folderName } from '../../src/files/names';
import type { NamingFormat } from '../../src/settings';
import type { Scene } from '../../src/scenes/types';

const scene = (over: Partial<Scene> = {}): Scene => ({
  id: 'scene-01',
  slide: 1,
  start: 0,
  end: 3,
  sentence: 'Every month my phone bill went up.',
  concept: '',
  textOverlay: '',
  imagePrompt: '',
  motionPrompt: '',
  motionPromptIsDefault: true,
  ...over,
});

describe('file names', () => {
  it.each<[NamingFormat, string]>([
    ['slide-time', 'Slide_01_00m00s-00m03s.png'],
    ['slide-timecode', 'Slide_01_00-00_to_00-03.png'],
    ['slide-seconds', 'Slide_01_00s-03s.png'],
    ['time-slide', '00m00s-00m03s_Slide_01.png'],
    ['slide', 'Slide_01.png'],
  ])('%s names slide 1 (0–3 s) %s', (format, name) => {
    expect(fileName(scene(), format, 'chosen', 'png')).toBe(name);
  });

  it('uses the scene’s own timecode, past a minute', () => {
    const s = scene({ slide: 12, start: 65, end: 68.6 });
    expect(fileName(s, 'slide-time', 'chosen', 'jpg')).toBe('Slide_12_01m05s-01m08s.jpg');
    expect(fileName(s, 'slide-timecode', 'chosen', 'jpg')).toBe('Slide_12_01-05_to_01-08.jpg');
    expect(fileName(s, 'slide-seconds', 'chosen', 'jpg')).toBe('Slide_12_65s-68s.jpg');
    expect(fileName(s, 'time-slide', 'chosen', 'jpg')).toBe('01m05s-01m08s_Slide_12.jpg');
  });

  it('no timecode → Slide_01', () => {
    for (const format of ['slide-time', 'slide-timecode', 'slide-seconds', 'time-slide', 'slide'] as const) {
      expect(fileName(scene({ start: null, end: null }), format, 'chosen', 'png')).toBe('Slide_01.png');
      expect(fileName(scene({ start: 4, end: null }), format, 'chosen', 'png')).toBe('Slide_01.png');
    }
  });

  it('other option gets _option2 (and _option3, _option4 for more pictures)', () => {
    expect(fileName(scene(), 'slide-time', 'other', 'png')).toBe('Slide_01_00m00s-00m03s_option2.png');
    expect(fileName(scene({ start: null }), 'slide', 'other', 'webp')).toBe('Slide_01_option2.webp');
    expect(fileName(scene(), 'slide', 'other', 'png', 3)).toBe('Slide_01_option3.png');
  });

  it('a slide past 99 keeps all its digits', () => {
    expect(fileName(scene({ slide: 104, start: null }), 'slide', 'chosen', 'png')).toBe('Slide_104.png');
  });

  it('the extension comes from the picture type', () => {
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/webp')).toBe('webp');
    expect(extFor('')).toBe('png');
  });

  it('the folder is the video name made safe for a file name', () => {
    expect(folderName('Phone Bill Story')).toBe('Phone Bill Story');
    expect(folderName('  Why: cats / knock * things "over"?  ')).toBe('Why cats knock things over');
    expect(folderName('a\\b|c<d>e')).toBe('abcde');
    expect(folderName('..')).toBe('VidFlow');
    expect(folderName('   ')).toBe('VidFlow');
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSceneFile, parseTimecode } from '../../src/scenes/parse';
import { defaultMotionPrompt } from '../../src/scenes/motion';

const HEADER = 'Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt';

describe('parseSceneFile', () => {
  it('parses the VidFlow CSV header', () => {
    const text = [
      HEADER,
      'Slide 02,00:04 - 00:09,I woke up late.,Waking,LATE,A stickman in bed,Stickman sits up',
    ].join('\n');
    const { scenes, issues } = parseSceneFile(text);
    expect(issues).toEqual([]);
    expect(scenes).toEqual([
      {
        id: 'scene-02',
        slide: 2,
        start: 4,
        end: 9,
        sentence: 'I woke up late.',
        concept: 'Waking',
        textOverlay: 'LATE',
        imagePrompt: 'A stickman in bed',
        motionPrompt: 'Stickman sits up',
        motionPromptIsDefault: false,
      },
    ]);
  });

  it('maps columns in any order and any header case', () => {
    const text = ['IMAGE PROMPT,slide,sentence', 'A cat,3,Meow.'].join('\n');
    const { scenes } = parseSceneFile(text);
    expect(scenes[0]).toMatchObject({ id: 'scene-03', slide: 3, sentence: 'Meow.', imagePrompt: 'A cat' });
  });

  it("accepts Flow Flash's six-column file", () => {
    const text = [
      'Slide,Timecode,Sentence,Concept,Text Overlay,Prompt',
      '1,00:00 - 00:03,Hi there.,Greeting,HI,A stickman waves',
    ].join('\n');
    const { scenes } = parseSceneFile(text);
    expect(scenes[0].imagePrompt).toBe('A stickman waves');
    expect(scenes[0].motionPromptIsDefault).toBe(true);
  });

  it('accepts plain and numbered lines', () => {
    const { scenes } = parseSceneFile('1. A stickman waves\n2. A stickman sits\n\nA stickman runs');
    expect(scenes).toHaveLength(3);
    expect(scenes[0]).toMatchObject({ id: 'scene-01', slide: 1, imagePrompt: 'A stickman waves' });
    expect(scenes[1].slide).toBe(2);
    expect(scenes[2]).toMatchObject({ slide: 3, imagePrompt: 'A stickman runs' });
  });

  it('fills a missing motion prompt', () => {
    const text = [HEADER, '1,,So I switched it off.,,,A stickman at a switch,'].join('\n');
    const { scenes } = parseSceneFile(text);
    expect(scenes[0].motionPrompt).toBe(defaultMotionPrompt('So I switched it off.'));
    expect(scenes[0].motionPromptIsDefault).toBe(true);
  });

  it('falls back to the image prompt for the default motion prompt', () => {
    const text = [HEADER, '1,,,,,A stickman at a switch,'].join('\n');
    const { scenes } = parseSceneFile(text);
    expect(scenes[0].motionPrompt).toBe(defaultMotionPrompt('A stickman at a switch'));
  });

  it('keeps quoted commas emoji and non-English text', () => {
    const text = [
      HEADER,
      '1,,"Hello, world 👋",c,t,img one,m',
      '2,,"Ẹ kú àárọ̀",c,t,img two,m',
    ].join('\n');
    const { scenes } = parseSceneFile(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].sentence).toBe('Hello, world 👋');
    expect(scenes[1].sentence).toBe('Ẹ kú àárọ̀');
  });

  it('reports problems without dropping rows', () => {
    const text = [
      HEADER,
      '1,,s1,c,t,img1,m',
      '2,,s2,c,t,img2,m',
      '3,,s3,c,t,,m',
    ].join('\n');
    const { scenes, issues } = parseSceneFile(text);
    expect(scenes).toHaveLength(3);
    expect(issues).toEqual([{ line: 4, message: 'Scene 3 has no image prompt.' }]);
  });

  it('strips a fenced code block', () => {
    const csv = [HEADER, '1,00:00 - 00:03,Hi.,c,t,A stickman,m'].join('\n');
    const plain = parseSceneFile(csv);
    const fenced = parseSceneFile('Here you go:\n```csv\n' + csv + '\n```\nEnjoy!');
    expect(fenced).toEqual(plain);
    expect(fenced.scenes).toHaveLength(1);
  });

  it('recovers every row when a quote is never closed', () => {
    const text = [
      HEADER,
      '1,,s1,c,t,img1,m',
      '2,,"hi,c,t,img2,m',
      '3,,s3,c,t,img3,m',
      '4,,s4,c,t,img4,m',
    ].join('\n');
    const { scenes, issues } = parseSceneFile(text);
    expect(scenes).toHaveLength(4);
    expect(scenes.map((s) => s.slide)).toEqual([1, 2, 3, 4]);
    expect(scenes[3].imagePrompt).toBe('img4');
    expect(issues.some((i) => i.line === 3 && /quote/i.test(i.message))).toBe(true);
  });

  it('does not mistake a numbered line that mentions "prompt" for a header', () => {
    const text = '1. A stickman gives a prompt, then leaves\n2. A stickman sits';
    const { scenes } = parseSceneFile(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ slide: 1, imagePrompt: 'A stickman gives a prompt, then leaves' });
  });

  it('uses plain number ids for slides of 100 or more', () => {
    const { scenes } = parseSceneFile([HEADER, '100,,s,c,t,img,m'].join('\n'));
    expect(scenes[0].id).toBe('scene-100');
  });
});

describe('parseTimecode', () => {
  it('handles MM:SS - MM:SS and seconds', () => {
    expect(parseTimecode('00:04 - 00:09')).toEqual({ start: 4, end: 9 });
    expect(parseTimecode('1:02–1:07')).toEqual({ start: 62, end: 67 });
    expect(parseTimecode('6s-7s')).toEqual({ start: 6, end: 7 });
    expect(parseTimecode('soon')).toBeNull();
  });
});

describe('defaultMotionPrompt', () => {
  it('is short and about movement', () => {
    const out = defaultMotionPrompt('So I switched everything off.');
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('So I switched everything off');
    expect(out.startsWith('Gentle, natural movement:')).toBe(true);
  });

  it('truncates very long text to 200 chars', () => {
    expect(defaultMotionPrompt('word '.repeat(100)).length).toBeLessThanOrEqual(200);
  });
});

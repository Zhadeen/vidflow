import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildClaudePrompt, buildRapidBeatPrompt } from '../../src/prompts/claude';
import { parseSceneFile } from '../../src/scenes/parse';

describe('buildClaudePrompt', () => {
  const script = 'Hello there. This is my script.';
  const out = buildClaudePrompt(script);

  it('asks for the exact CSV header', () => {
    expect(out).toContain('Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt');
  });

  it('states the scene rules', () => {
    expect(out).toContain('never skip');
    expect(out).toContain('split');
    expect(out).toContain('3 to 6 seconds');
    expect(out).toContain('the hero');
    expect(out).toMatch(/do not (include|mention)[^\n]*(art style|stickman|cartoon)/i);
    expect(out).toMatch(/stickman[^\n]*cartoon[^\n]*2D[^\n]*3D[^\n]*realistic/i);
  });

  it('appends the script last', () => {
    expect(out.endsWith(`SCRIPT:\n${script}`)).toBe(true);
  });

  it('round-trips with the parser', () => {
    const reply = readFileSync('tests/fixtures/claude-reply.csv', 'utf8');
    const { scenes, issues } = parseSceneFile(reply);
    expect(scenes).toHaveLength(4);
    expect(issues).toEqual([]);
  });
});

describe('buildRapidBeatPrompt', () => {
  const script = 'One two three four five six.';
  const out = buildRapidBeatPrompt(script);

  it('asks for ~6-word beats and the single Prompt header', () => {
    expect(out).toContain('every 6 words');
    expect(out).toContain('Slide,Timecode,Sentence,Concept,Text Overlay,Prompt');
    expect(out).toContain('the hero protagonist');
  });

  it('appends the script last', () => {
    expect(out.endsWith(`SCRIPT:\n${script}`)).toBe(true);
  });

  it('its CSV shape parses, with a default motion prompt', () => {
    const csv = 'Slide,Timecode,Sentence,Concept,Text Overlay,Prompt\n"Slide 01","00:00 - 00:03","One two three four five six.","Counting","COUNT","The hero protagonist counting on fingers, close-up."';
    const { scenes, issues } = parseSceneFile(csv);
    expect(issues).toEqual([]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].imagePrompt).toContain('hero protagonist');
    expect(scenes[0].motionPromptIsDefault).toBe(true);
  });
});

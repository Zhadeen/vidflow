import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildClaudePrompt } from '../../src/prompts/claude';
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

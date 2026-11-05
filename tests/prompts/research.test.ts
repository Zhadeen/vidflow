import { describe, it, expect } from 'vitest';
import { RESEARCH_PROMPTS, buildResearchPrompt } from '../../src/prompts/research';

describe('research prompts', () => {
  it('has the four prompts in order', () => {
    expect(RESEARCH_PROMPTS.map((p) => p.id)).toEqual(['analyse', 'rewrite', 'packaging', 'thumbnail']);
  });

  it('analyse asks for the four-part breakdown and leaves a blank for the transcript', () => {
    const out = buildResearchPrompt('analyse', 'ignored');
    expect(out).toContain('[PASTE TRANSCRIPT HERE]');
    expect(out).toMatch(/Core Premise[\s\S]*Section-by-Section[\s\S]*Retention Triggers[\s\S]*Claims Check/);
  });

  it('rewrite demands new phrasing and a fresh angle', () => {
    const out = buildResearchPrompt('rewrite', '');
    expect(out).toContain('[INSERT STRUCTURAL OUTLINE');
    expect(out).toMatch(/Do NOT use the same phrasing/);
    expect(out).toMatch(/micro-cliffhangers every 40-50 seconds/);
  });

  it('packaging includes the owner script, or a blank when there is none', () => {
    expect(buildResearchPrompt('packaging', ' My script. ').endsWith('Video Script Summary:\nMy script.')).toBe(true);
    expect(buildResearchPrompt('packaging', '  ')).toContain('[INSERT SCRIPT HERE]');
  });

  it('thumbnail leaves a blank for the text', () => {
    expect(buildResearchPrompt('thumbnail', '')).toContain('[INSERT TEXT HERE]');
  });

  it('rejects an unknown id', () => {
    // @ts-expect-error deliberately wrong
    expect(() => buildResearchPrompt('nope', '')).toThrow();
  });
});

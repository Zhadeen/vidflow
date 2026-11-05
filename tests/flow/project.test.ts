import { describe, expect, it } from 'vitest';
import { flowProjectAction, isFlowHome, projectUrlOf } from '../../src/flow/project';

const P = 'https://flow.google.com/u/0/project/3f1c2a9e-1111-4222-8333-944455556666';

describe('Flow project URLs', () => {
  it('recognises the home page', () => {
    expect(isFlowHome('https://flow.google.com/')).toBe(true);
    expect(isFlowHome('https://flow.google.com/u/0/')).toBe(true);
    expect(isFlowHome('https://flow.google.com/?hl=en')).toBe(true);
    expect(isFlowHome(P)).toBe(false);
    expect(isFlowHome(undefined)).toBe(false);
  });

  it('extracts the project URL, dropping picture-detail paths', () => {
    expect(projectUrlOf(`${P}/edit/abc`)).toBe(P);
    expect(projectUrlOf(`${P}?x=1`)).toBe(P);
    expect(projectUrlOf('https://flow.google.com/')).toBeNull();
  });
});

describe('flowProjectAction', () => {
  it('a new run creates a new project, from the home page', () => {
    expect(flowProjectAction(undefined, 'https://flow.google.com/')).toEqual({ kind: 'create', goHome: false });
  });

  it('a new run creates a new project even when the tab shows an older one', () => {
    expect(flowProjectAction(undefined, P)).toEqual({ kind: 'create', goHome: true });
  });

  it('the same run reuses its project', () => {
    expect(flowProjectAction(P, P)).toEqual({ kind: 'ok' });
    expect(flowProjectAction(P, `${P}/edit/abc`)).toEqual({ kind: 'navigate', url: P });
  });

  it('the same run goes back to its project when the tab wandered', () => {
    expect(flowProjectAction(P, 'https://flow.google.com/')).toEqual({ kind: 'navigate', url: P });
    expect(flowProjectAction(P, 'https://flow.google.com/u/0/project/other')).toEqual({ kind: 'navigate', url: P });
  });
});

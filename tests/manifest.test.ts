// @vitest-environment node
// wxt.config imports the wxt toolkit, which needs real Node globals rather than jsdom.
import { describe, expect, it } from 'vitest';
import { manifest } from '../wxt.config';

describe('manifest', () => {
  it('is named VidFlow', () => {
    expect(manifest.name).toBe('VidFlow');
  });

  it('only asks for the Google hosts it needs', () => {
    expect(manifest.host_permissions).toEqual([
      'https://flow.google.com/*',
      'https://labs.google/*',
      'https://aistudio.google.com/*',
    ]);
  });

  it('asks for the needed permissions and not debugger or cookies', () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'unlimitedStorage', 'downloads', 'notifications', 'power', 'tabs', 'alarms']),
    );
    expect(manifest.permissions).not.toContain('debugger');
    expect(manifest.permissions).not.toContain('cookies');
  });
});

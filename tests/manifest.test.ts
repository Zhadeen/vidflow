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
      'https://flow-content.google/*',
    ]);
  });

  it('asks for the needed permissions and not cookies', () => {
    // debugger: Flow's Generate ignores synthetic clicks, so VidFlow presses it with trusted input (spike S5).
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        'storage', 'unlimitedStorage', 'downloads', 'notifications', 'power', 'tabs', 'alarms', 'debugger',
      ]),
    );
    expect(manifest.permissions).not.toContain('cookies');
  });

  it('opens its side panel beside Flow', () => {
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel).toEqual({ default_path: 'sidepanel.html' });
    // No popup: the toolbar click must reach the background (side panel on Flow, the studio elsewhere).
    expect(manifest.action).not.toHaveProperty('default_popup');
  });
});

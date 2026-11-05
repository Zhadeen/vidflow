import { defineConfig } from 'wxt';

export const manifest = {
  name: 'VidFlow',
  description: 'Makes stickman videos by driving Google Flow.',
  permissions: ['storage', 'unlimitedStorage', 'downloads', 'notifications', 'power', 'tabs', 'alarms', 'debugger', 'sidePanel'],
  host_permissions: [
    'https://flow.google.com/*',
    'https://labs.google/*',
    'https://aistudio.google.com/*',
    'https://flow-content.google/*',
  ],
  action: { default_title: 'VidFlow' },
  // Beside Flow: the toolbar button opens it on a Flow tab (background openForTab).
  side_panel: { default_path: 'sidepanel.html' },
};

export default defineConfig({
  srcDir: 'src',
  // The e2e build must land in the same folder as the normal one, so Chrome loads one path.
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  modules: ['@wxt-dev/module-react'],
  manifest,
});

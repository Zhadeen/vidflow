import { defineConfig } from 'wxt';

export const manifest = {
  name: 'VidFlow',
  description: 'Makes stickman videos by driving Google Flow.',
  permissions: ['storage', 'unlimitedStorage', 'downloads', 'notifications', 'power', 'tabs', 'alarms', 'debugger'],
  host_permissions: [
    'https://flow.google.com/*',
    'https://labs.google/*',
    'https://aistudio.google.com/*',
    'https://flow-content.google/*',
  ],
  action: { default_title: 'VidFlow' },
};

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest,
});

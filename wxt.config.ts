import { defineConfig } from 'wxt';

export const manifest = {
  name: 'VidFlow',
  description: 'Makes stickman videos by driving Google Flow.',
  permissions: ['storage', 'unlimitedStorage', 'downloads', 'notifications', 'power', 'tabs'],
  host_permissions: [
    'https://flow.google.com/*',
    'https://labs.google/*',
    'https://aistudio.google.com/*',
  ],
  action: { default_title: 'VidFlow' },
};

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest,
});

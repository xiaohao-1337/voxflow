import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'apps/extension/src',
  outDir: 'dist/extension',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'VoxFlow',
    description: 'Local-first real-time web video voice translation.',
    version: '0.1.0',
    permissions: ['offscreen', 'storage', 'scripting', 'activeTab', 'tabCapture'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'VoxFlow',
    },
  },
});

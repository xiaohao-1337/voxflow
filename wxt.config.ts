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
    host_permissions: [
      '<all_urls>',
      'http://127.0.0.1:8765/*',
      'ws://127.0.0.1:8765/*',
      'http://localhost:8765/*',
      'ws://localhost:8765/*',
    ],
    action: {
      default_title: 'VoxFlow',
    },
    content_security_policy: {
      extension_pages: [
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000",
        "object-src 'self'",
        "connect-src 'self' ws://localhost:3000 ws://localhost:3000/* http://localhost:3000 http://localhost:3000/* ws://127.0.0.1:8765 ws://127.0.0.1:8765/* ws://localhost:8765 ws://localhost:8765/* http://127.0.0.1:8765 http://127.0.0.1:8765/* http://localhost:8765 http://localhost:8765/*",
      ].join('; '),
    },
  },
});

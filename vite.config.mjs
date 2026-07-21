import { defineConfig, loadEnv, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const browserModuleAliases = new Map([
  [path.resolve(rootDir, 'src/shared/utils/machineId.js'), path.resolve(rootDir, 'src/vite/browser/machineId.js')],
  [path.resolve(rootDir, 'src/lib/dataDir.js'), path.resolve(rootDir, 'src/vite/browser/dataDir.js')],
  [path.resolve(rootDir, 'open-sse/providers/shared.js'), path.resolve(rootDir, 'src/vite/browser/providerShared.js')],
]);

const browserSafeModuleAliases = {
  name: 'browser-safe-module-aliases',
  enforce: 'pre',
  resolveId(source, importer) {
    const resolved = source.startsWith('.') && importer
      ? path.resolve(path.dirname(importer), source)
      : source;
    return browserModuleAliases.get(resolved) || browserModuleAliases.get(`${resolved}.js`) || null;
  },
};

const jsxInJavaScript = {
  name: 'jsx-in-javascript',
  enforce: 'pre',
  async transform(code, id) {
    const cleanId = id.split('?', 1)[0];
    if (!cleanId.startsWith(path.resolve(rootDir, 'src')) || !cleanId.endsWith('.js')) return null;
    return transformWithEsbuild(code, cleanId, { loader: 'jsx', jsx: 'automatic' });
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.API_PORT || env.API_PORT || '20129';

  return {
    plugins: [browserSafeModuleAliases, jsxInJavaScript, react({ include: /\.[jt]sx?$/ })],
    define: {
      // Next replaces process.env in browser bundles. Keep the Vite dev graph
      // browser-safe without exposing any real server environment variables.
      'process.env': {},
    },
    resolve: {
      alias: [
        { find: '@/shared/utils/machineId.js', replacement: path.resolve(rootDir, 'src/vite/browser/machineId.js') },
        { find: '@/shared/utils/machineId', replacement: path.resolve(rootDir, 'src/vite/browser/machineId.js') },
        { find: '@/lib/dataDir.js', replacement: path.resolve(rootDir, 'src/vite/browser/dataDir.js') },
        { find: '@/lib/dataDir', replacement: path.resolve(rootDir, 'src/vite/browser/dataDir.js') },
        { find: 'open-sse/providers/shared.js', replacement: path.resolve(rootDir, 'src/vite/browser/providerShared.js') },
        { find: 'open-sse/providers/shared', replacement: path.resolve(rootDir, 'src/vite/browser/providerShared.js') },
        { find: '@', replacement: path.resolve(rootDir, 'src') },
        { find: 'open-sse', replacement: path.resolve(rootDir, 'open-sse') },
        { find: 'next/navigation', replacement: path.resolve(rootDir, 'src/vite/compat/navigation.jsx') },
        { find: 'next/link', replacement: path.resolve(rootDir, 'src/vite/compat/link.jsx') },
        { find: 'next/image', replacement: path.resolve(rootDir, 'src/vite/compat/image.jsx') },
        { find: 'next/dynamic', replacement: path.resolve(rootDir, 'src/vite/compat/dynamic.jsx') },
        { find: 'next/script', replacement: path.resolve(rootDir, 'src/vite/compat/script.jsx') },
        { find: 'next/head', replacement: path.resolve(rootDir, 'src/vite/compat/head.jsx') },
        { find: 'next/font/google', replacement: path.resolve(rootDir, 'src/vite/compat/font-google.jsx') },
        { find: '@next/third-parties/google', replacement: path.resolve(rootDir, 'src/vite/compat/google.jsx') },
      ],
    },
    server: {
      // Tailscale Funnel / Serveo / LAN hostnames hit Vite first; without this
      // Vite 6+ returns 403 "This host is not allowed".
      allowedHosts: true,
      proxy: Object.fromEntries(
        ['/api', '/v1', '/v1beta', '/mcp'].map((prefix) => [prefix, {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          xfwd: true,
        }]),
      ),
    },
    optimizeDeps: {
      // Rolldown's dependency scanner parses app .js before plugins run and
      // chokes on JSX. Disable discovery, but explicitly prebundle the CJS
      // dependencies that require ESM interop in the browser.
      noDiscovery: true,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'prop-types',
        'react-is',
        'recharts',
        'decimal.js-light',
        'lodash',
        'zustand',
        'zustand/middleware',
        'use-sync-external-store/with-selector',
        'use-sync-external-store/with-selector.js',
        'use-sync-external-store/shim/with-selector',
        'use-sync-external-store/shim/with-selector.js',
      ],
    },
    build: {
      outDir: 'dist',
    },
  };
});

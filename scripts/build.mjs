/**
 * Build script: bundles main, preload and renderer with esbuild and copies
 * static assets into dist/.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = (...p) => join(root, 'dist', ...p);

mkdirSync(out('renderer'), { recursive: true });
mkdirSync(out('assets'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

// Electron main process (CommonJS)
await build({
  ...common,
  entryPoints: [join(root, 'src/main/index.ts')],
  outfile: out('main/index.js'),
  format: 'cjs',
  external: ['electron'],
});

// Preload (CommonJS, sandboxed — only electron may be required)
await build({
  ...common,
  entryPoints: [join(root, 'src/preload/index.ts')],
  outfile: out('preload/index.js'),
  format: 'cjs',
  external: ['electron'],
});

// Renderer (browser IIFE)
await build({
  entryPoints: [join(root, 'src/renderer/app.ts')],
  outfile: out('renderer/app.js'),
  format: 'iife',
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});

// Static files
copyFileSync(join(root, 'src/renderer/index.html'), out('renderer/index.html'));
copyFileSync(join(root, 'src/renderer/styles.css'), out('renderer/styles.css'));
cpSync(join(root, 'assets'), out('assets'), { recursive: true });

// xterm.css for the Workflow embedded terminal
try {
  copyFileSync(
    join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
    out('renderer/xterm.css'),
  );
} catch (err) {
  console.warn('Could not copy xterm.css:', err);
}

console.log('Build complete -> dist/');

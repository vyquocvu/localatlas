import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const minimumNode = [22, 13];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < minimumNode[0] || (major === minimumNode[0] && minor < minimumNode[1])) {
  throw new Error('LocalAtlas desktop builds require Node.js 22.13 or newer');
}

const projectRoot = resolve(import.meta.dirname, '..');
const outputPath = resolve(projectRoot, 'dist-tauri/localatlas.mjs');

await mkdir(dirname(outputPath), { recursive: true });

await build({
  entryPoints: [resolve(projectRoot, 'src/cli.ts')],
  outfile: outputPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  packages: 'bundle',
});

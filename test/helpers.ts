import { rm } from 'node:fs/promises';
import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { closeDatabase } from '../src/core/db.js';

const execFileAsync = promisify(execFile);
const tsxCliPath = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

export function closeTestDatabase(): void {
  closeDatabase();
}

export function runTsx(args: string[], options?: ExecFileOptions) {
  return execFileAsync(process.execPath, [tsxCliPath, ...args], options) as Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export function runNpm(args: string[], options?: ExecFileOptions) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    throw new Error('npm_execpath is unavailable; run this test through `npm test`');
  }

  return execFileAsync(process.execPath, [npmCliPath, ...args], options) as Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export async function cleanupTestDirectory(directory: string): Promise<void> {
  closeDatabase();
  await rm(directory, { recursive: true, force: true });
}

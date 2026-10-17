import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { open, readFile, unlink, rename, readdir } from 'node:fs/promises';
import { ConflictError } from './errors.js';
import { ensureHomeDir, lockFilePath, serverLockPath } from './paths.js';

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function cleanupDeadTmpFiles(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.startsWith('.localatlas-tmp-')) {
        const match = entry.match(/^\.localatlas-tmp-(\d+)-/);
        if (match) {
          const pid = parseInt(match[1], 10);
          if (!isPidAlive(pid)) {
            await unlink(join(dir, entry)).catch(() => {});
          }
        }
      }
    }
  } catch {
    // Ignore ENOENT or read errors
  }
}

export async function atomicWrite(path: string, value: string | Buffer): Promise<void> {
  await cleanupDeadTmpFiles(dirname(path)).catch(() => {});
  const temp = join(dirname(path), `.localatlas-tmp-${process.pid}-${randomUUID()}`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await handle.datasync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}

let inProcessLockQueue: Promise<void> = Promise.resolve();
let inProcessLockDepth = 0;

export async function isLockFileActive(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: number };
    if (typeof parsed.pid === 'number' && isPidAlive(parsed.pid)) return true;
    await unlink(path).catch(() => {});
    return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return true;
  }
}

export async function registerServerLock(): Promise<() => Promise<void>> {
  await ensureHomeDir();
  const spath = serverLockPath();
  await atomicWrite(spath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  return async () => {
    await unlink(spath).catch(() => {});
  };
}

export async function isWorkspaceLocked(): Promise<boolean> {
  if (inProcessLockDepth > 0) return true;
  if (await isLockFileActive(lockFilePath())) return true;
  if (await isLockFileActive(serverLockPath())) return true;
  return false;
}

export async function withWorkspaceLock<T>(
  fn: () => Promise<T>,
  options?: { failFast?: boolean; timeoutMs?: number }
): Promise<T> {
  if (inProcessLockDepth > 0) {
    inProcessLockDepth++;
    try {
      return await fn();
    } finally {
      inProcessLockDepth--;
    }
  }
  let releaseQueue!: () => void;
  const prevQueue = inProcessLockQueue;
  inProcessLockQueue = new Promise<void>(r => {
    releaseQueue = r;
  });
  await prevQueue;

  inProcessLockDepth++;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  const lpath = lockFilePath();
  let acquired = false;
  try {
    await ensureHomeDir();
    while (!acquired) {
      try {
        const handle = await open(lpath, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        } finally {
          await handle.close();
        }
        acquired = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          const raw = await readFile(lpath, 'utf8');
          const holder = JSON.parse(raw) as { pid?: number };
          if (typeof holder.pid === 'number' && !isPidAlive(holder.pid)) {
            await unlink(lpath).catch(() => {});
            continue;
          }
        } catch {
          // Ignore parse/read race while another process writes lockfile
        }
        if (options?.failFast || Date.now() >= deadline) {
          throw new ConflictError('Workspace is locked by another LocalAtlas process');
        }
        await new Promise(r => setTimeout(r, 20));
      }
    }
    return await fn();
  } finally {
    if (acquired) {
      await unlink(lpath).catch(() => {});
    }
    inProcessLockDepth--;
    releaseQueue();
  }
}

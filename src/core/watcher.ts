import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { watch, FSWatcher } from 'node:fs';
import { Project } from './types.js';
import { projects } from './projects.js';
import { reconcileProjectIndex } from './search.js';
import { listDocs } from './documents.js';
import { emitProjectEvent } from './events.js';

export async function startWorkspaceWatcher(
  options?: { intervalMs?: number }
): Promise<{ close: () => Promise<void> }> {
  const intervalMs = options?.intervalMs ?? 30_000;
  const watchers = new Map<string, FSWatcher>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const snapshots = new Map<string, string>();
  let closed = false;

  async function filesystemSnapshot(project: Project): Promise<string> {
    const docs = await listDocs(project);
    const entries = await Promise.all(docs.map(async docPath => {
      const details = await stat(join(project.managedPath, 'docs', docPath)).catch(() => null);
      return details ? `${docPath}\0${details.size}\0${details.mtimeMs}\0${details.ino}` : `${docPath}\0missing`;
    }));
    return entries.join('\n');
  }

  async function refreshProject(project: Project, notify: boolean): Promise<void> {
    const before = snapshots.get(project.id);
    const reconciliation = await reconcileProjectIndex(project).catch(() => ({ changed: 0 }));
    const after = await filesystemSnapshot(project).catch(() => '');
    snapshots.set(project.id, after);
    if (notify && before !== undefined && before !== after && reconciliation.changed === 0) {
      emitProjectEvent({ projectId: project.id, type: 'reindexed' });
    }
  }

  async function syncProjectWatchers(): Promise<void> {
    if (closed) return;
    const allProjects = await projects().catch(() => [] as Project[]);
    for (const proj of allProjects) {
      await refreshProject(proj, true);
      if (closed) return;
      if (!watchers.has(proj.id)) {
        const docsDir = join(proj.managedPath, 'docs');
        await mkdir(docsDir, { recursive: true }).catch(() => {});
        try {
          const w = watch(docsDir, { recursive: true }, (_eventType, filename) => {
            if (closed) return;
            if (filename && String(filename).includes('.localatlas-tmp-')) return;
            const prev = debounceTimers.get(proj.id);
            if (prev) clearTimeout(prev);
            debounceTimers.set(
              proj.id,
              setTimeout(() => {
                debounceTimers.delete(proj.id);
                if (!closed) {
                  refreshProject(proj, true).catch(() => {});
                }
              }, 120)
            );
          });
          watchers.set(proj.id, w);
        } catch {
          // Recursive fs.watch fallback relies on periodic reconciliation
        }
      }
    }
  }

  await syncProjectWatchers();
  const timer = setInterval(() => {
    syncProjectWatchers().catch(() => {});
  }, intervalMs);
  timer.unref?.();

  return {
    async close(): Promise<void> {
      closed = true;
      clearInterval(timer);
      for (const t of debounceTimers.values()) clearTimeout(t);
      debounceTimers.clear();
      for (const w of watchers.values()) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
      watchers.clear();
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
const loadUiModule = (path: string): Promise<any> => import(path);
const { useDocumentStore } = await loadUiModule('../src/ui/stores/useDocumentStore.js');
const { useTaskStore } = await loadUiModule('../src/ui/stores/useTaskStore.js');
const { useWorkspaceStore } = await loadUiModule('../src/ui/stores/useWorkspaceStore.js');
const draftStorage = new Map<string, string>();

function installWindow(): void {
  draftStorage.clear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash: '' },
      confirm: () => false,
      prompt: () => null,
      alert: () => undefined,
      localStorage: {
        getItem: (key: string) => draftStorage.get(key) ?? null,
        setItem: (key: string, value: string) => draftStorage.set(key, String(value)),
        removeItem: (key: string) => draftStorage.delete(key),
      },
    },
  });
}

test('document drafts survive reload and remain isolated by project', async () => {
  const previousFetch = globalThis.fetch;
  installWindow();
  useWorkspaceStore.setState({ activeProject: { id: 'A' } as never });
  const draftKey = 'localatlas:draft:A:notes%2Fplan.md';
  draftStorage.set(draftKey, JSON.stringify({ content: '# Local draft', baseEtag: 'old-etag', savedAt: '2026-10-25T00:00:00.000Z' }));
  globalThis.fetch = async input => {
    if (String(input).includes('/backlinks/')) return Response.json([]);
    return new Response('# Disk version', { headers: { etag: 'disk-etag' } });
  };

  try {
    await useDocumentStore.getState().openDocument({ id: 'A' }, 'notes/plan.md');
    assert.equal(useDocumentStore.getState().content, '# Disk version');
    assert.equal(useDocumentStore.getState().recoveryDraft.content, '# Local draft');
    useDocumentStore.getState().restoreDraft();
    assert.equal(useDocumentStore.getState().content, '# Local draft');
    assert.equal(useDocumentStore.getState().etag, 'old-etag');
    assert.equal(useDocumentStore.getState().dirty, true);

    useDocumentStore.getState().setContent('# Edited in project A');
    useWorkspaceStore.setState({ activeProject: { id: 'B' } as never });
    useDocumentStore.getState().setContent('# Edited in project B');
    assert.ok(draftStorage.get('localatlas:draft:A:notes%2Fplan.md'));
    assert.ok(draftStorage.get('localatlas:draft:B:notes%2Fplan.md'));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('document conflict shows disk content and only retries against its current ETag', async () => {
  const previousFetch = globalThis.fetch;
  installWindow();
  useWorkspaceStore.setState({ activeProject: { id: 'A' } as never });
  useDocumentStore.setState({ activeDoc: 'note.md', content: '# Local version', etag: 'old-etag', dirty: true, isNewDoc: false });
  let putCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'PUT') {
      putCount++;
      if (putCount === 1) return Response.json({ error: 'stale', currentEtag: 'disk-etag' }, { status: 409 });
      assert.equal(new Headers(init.headers).get('if-match'), 'disk-etag');
      assert.equal(init.body, '# Local version');
      return new Response('', { headers: { etag: 'saved-etag' } });
    }
    if (url.includes('/docs/')) return new Response('# Disk version', { headers: { etag: 'disk-etag' } });
    if (url.includes('/backlinks/')) return Response.json([]);
    return Response.json([]);
  };

  try {
    await useDocumentStore.getState().saveDocument();
    assert.equal(useDocumentStore.getState().conflict.diskContent, '# Disk version');
    assert.equal(useDocumentStore.getState().conflict.currentEtag, 'disk-etag');
    await useDocumentStore.getState().saveLocalVersion();
    assert.equal(putCount, 2);
    assert.equal(useDocumentStore.getState().conflict, null);
    assert.equal(useDocumentStore.getState().dirty, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('editing and saving a document preserves newer keystrokes as unsaved', async () => {
  const previousFetch = globalThis.fetch;
  installWindow();
  useWorkspaceStore.setState({ activeProject: { id: 'A' } as never });
  useDocumentStore.setState({ activeDoc: 'note.md', content: '# Original', etag: 'old-etag', dirty: false, isNewDoc: false });

  let finishSave!: (response: Response) => void;
  const pendingSave = new Promise<Response>(resolve => { finishSave = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'PUT') return pendingSave;
    if (url.includes('/backlinks/')) return Response.json([]);
    if (url.includes('/health')) return Response.json({});
    if (url.includes('/overview')) return Response.json([]);
    if (url.includes('/portfolio/summary')) return Response.json({});
    if (url.includes('/templates')) return Response.json([]);
    return Response.json([]);
  };

  try {
    useDocumentStore.getState().setContent('# First edit');
    assert.equal(useDocumentStore.getState().dirty, true);
    assert.equal(useDocumentStore.getState().canDiscard(), false);

    const save = useDocumentStore.getState().saveDocument();
    useDocumentStore.getState().setContent('# Newer edit while saving');
    finishSave(new Response('', { headers: { etag: 'new-etag' } }));
    await save;

    assert.equal(useDocumentStore.getState().content, '# Newer edit while saving');
    assert.equal(useDocumentStore.getState().dirty, true);
    assert.equal(useDocumentStore.getState().etag, 'new-etag');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('late task responses cannot replace the active project after an A-to-B-to-A switch', async () => {
  const previousFetch = globalThis.fetch;
  useWorkspaceStore.getState().setActiveProject({ id: 'A' } as never);
  useTaskStore.setState({ tasks: [] });

  let finishProjectA!: (response: Response) => void;
  let projectARequestCount = 0;
  globalThis.fetch = async input => {
    if (String(input).includes('/A/')) {
      projectARequestCount++;
      if (projectARequestCount === 1) return new Promise<Response>(resolve => { finishProjectA = resolve; });
      return Response.json([{ id: 'A-002', title: 'Current project A task' }]);
    }
    return Response.json([{ id: 'B-001', title: 'Project B task' }]);
  };

  try {
    const requestA = useTaskStore.getState().loadTasks('A');
    useWorkspaceStore.getState().setActiveProject({ id: 'B' } as never);
    await useTaskStore.getState().loadTasks('B');
    useWorkspaceStore.getState().setActiveProject({ id: 'A' } as never);
    await useTaskStore.getState().loadTasks('A');
    finishProjectA(Response.json([{ id: 'A-001', title: 'Project A task' }]));
    await requestA;

    assert.deepEqual(useTaskStore.getState().tasks.map((task: { id: string }) => task.id), ['A-002']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

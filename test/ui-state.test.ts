import test from 'node:test';
import assert from 'node:assert/strict';
const loadUiModule = (path: string): Promise<any> => import(path);
const { useDocumentStore } = await loadUiModule('../src/ui/stores/useDocumentStore.js');
const { useTaskStore } = await loadUiModule('../src/ui/stores/useTaskStore.js');
const { useWorkspaceStore } = await loadUiModule('../src/ui/stores/useWorkspaceStore.js');

function installWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash: '' },
      confirm: () => false,
      prompt: () => null,
      alert: () => undefined,
    },
  });
}

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

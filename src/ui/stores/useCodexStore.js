import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore.js';

let activeEventSource = null;
let requestToken = 0;

export const useCodexStore = create((set, get) => ({
  codexMessages: [],
  codexThreadId: '',
  codexLoading: false,
  codexBusy: false,
  codexDraft: '',
  codexError: '',
  codexActivity: '',
  codexApproval: null,
  codexTaskScope: '',

  setCodexDraft: codexDraft => set({ codexDraft }),
  setCodexTaskScope: codexTaskScope => set({ codexTaskScope }),
  setCodexMessages: codexMessages => set({ codexMessages }),

  closeStream: () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
  },

  openCodexEventStream: (projectId, threadId, after = 0) => {
    get().closeStream();
    const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/${encodeURIComponent(threadId)}/events?after=${encodeURIComponent(after)}`);
    activeEventSource = source;

    source.addEventListener('codex', rawEvent => {
      let event;
      try { event = JSON.parse(rawEvent.data); } catch { return; }
      const data = event?.data || {};
      switch (event?.type) {
        case 'assistant-delta': {
          const id = String(data.itemId || data.item?.id || `assistant-${Date.now()}`);
          const delta = String(data.delta || '');
          if (!delta) break;
          set(state => {
            const index = state.codexMessages.findIndex(item => item.id === id);
            if (index < 0) return { codexMessages: [...state.codexMessages, { id, role: 'assistant', text: delta }] };
            return {
              codexMessages: state.codexMessages.map((item, itemIndex) => itemIndex === index ? { ...item, text: item.text + delta } : item),
            };
          });
          break;
        }
        case 'turn-started':
          set({ codexBusy: true, codexError: '' });
          break;
        case 'turn-completed':
          set({
            codexBusy: false,
            codexActivity: '',
            codexApproval: null,
            codexError: (data.status === 'failed' || data.status === 'interrupted') ? (data.error?.message || `Codex turn ${data.status}`) : '',
          });
          break;
        case 'item-started': {
          const item = data;
          set({
            codexActivity: item.type === 'commandExecution' ? `Running: ${item.command || 'command'}` : item.type === 'fileChange' ? 'Preparing a file change' : item.type === 'reasoning' ? 'Thinking…' : 'Working…',
          });
          break;
        }
        case 'item-completed':
          if (data.type === 'agentMessage' && typeof data.text === 'string') {
            const id = String(data.id || `assistant-${Date.now()}`);
            set(state => {
              const index = state.codexMessages.findIndex(item => item.id === id);
              if (index < 0) return { codexMessages: [...state.codexMessages, { id, role: 'assistant', text: data.text }] };
              return {
                codexMessages: state.codexMessages.map((item, itemIndex) => itemIndex === index ? { ...item, text: data.text } : item),
              };
            });
          }
          set({ codexActivity: '' });
          break;
        case 'approval-request':
          set({ codexApproval: data, codexActivity: 'Waiting for your approval' });
          break;
        case 'error':
          set({
            codexError: String(data.message || 'Codex chat encountered an error'),
            codexBusy: false,
          });
          break;
        case 'unsupported-request':
          set({ codexError: `This Codex action is not supported in the web chat yet (${data.method || 'unknown request'}).` });
          break;
        default:
          break;
      }
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        set({ codexError: 'The Codex chat connection closed. Reopen this project chat to reconnect.' });
      }
    };
  },

  initCodexSession: async projectId => {
    const token = ++requestToken;
    const storageKey = `localatlas:codex-thread:${projectId}`;
    get().closeStream();
    set({
      codexMessages: [],
      codexThreadId: '',
      codexBusy: false,
      codexDraft: '',
      codexError: '',
      codexActivity: '',
      codexApproval: null,
    });

    let savedThreadId = '';
    try { savedThreadId = localStorage.getItem(storageKey) || ''; } catch {}
    if (!savedThreadId) {
      set({ codexLoading: false });
      return;
    }

    set({ codexThreadId: savedThreadId, codexLoading: true });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: savedThreadId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to reopen this Codex chat');
      if (token !== requestToken) return;
      set({
        codexThreadId: body.threadId,
        codexMessages: Array.isArray(body.messages) ? body.messages : [],
        codexBusy: Boolean(body.busy),
      });
      get().openCodexEventStream(projectId, body.threadId, Number(body.eventSeq) || 0);
    } catch (error) {
      if (token === requestToken) set({ codexError: error instanceof Error ? error.message : 'Unable to reopen this Codex chat' });
    } finally {
      if (token === requestToken) set({ codexLoading: false });
    }
  },

  startCodexConversation: async overrideTaskId => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const { codexThreadId, codexTaskScope } = get();
    if (codexThreadId && !window.confirm('Start a new Codex chat for this project? The existing transcript remains in Codex history.')) return;

    const projectId = activeProject.id;
    const chosenTaskId = typeof overrideTaskId === 'string' ? overrideTaskId : codexTaskScope;
    const token = ++requestToken;

    set({
      codexLoading: true,
      codexError: '',
      codexMessages: [],
      codexBusy: false,
      codexApproval: null,
    });
    get().closeStream();

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: chosenTaskId || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to start Codex chat');
      if (token !== requestToken) return;
      set({
        codexThreadId: body.threadId,
        codexMessages: Array.isArray(body.messages) ? body.messages : [],
        codexBusy: Boolean(body.busy),
      });
      try { localStorage.setItem(`localatlas:codex-thread:${projectId}`, body.threadId); } catch {}
      get().openCodexEventStream(projectId, body.threadId, Number(body.eventSeq) || 0);
    } catch (error) {
      if (token === requestToken) set({ codexError: error instanceof Error ? error.message : 'Unable to start Codex chat' });
    } finally {
      if (token === requestToken) set({ codexLoading: false });
    }
  },

  sendCodexMessage: async () => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { codexThreadId, codexBusy, codexDraft } = get();
    if (!activeProject || !codexThreadId || codexBusy || !codexDraft.trim()) return;

    const text = codexDraft.trim();
    const messageId = `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    set(state => ({
      codexMessages: [...state.codexMessages, { id: messageId, role: 'user', text }],
      codexDraft: '',
      codexBusy: true,
      codexError: '',
    }));

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/codex-chat/${encodeURIComponent(codexThreadId)}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to send message to Codex');
    } catch (error) {
      set(state => ({
        codexMessages: state.codexMessages.filter(item => item.id !== messageId),
        codexDraft: text,
        codexError: error instanceof Error ? error.message : 'Unable to send message to Codex',
        codexBusy: false,
      }));
    }
  },

  respondToCodexApproval: async decision => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { codexThreadId, codexApproval } = get();
    if (!activeProject || !codexThreadId || !codexApproval) return;

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/codex-chat/${encodeURIComponent(codexThreadId)}/approvals/${encodeURIComponent(codexApproval.requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to respond to approval');
      set({
        codexApproval: null,
        codexActivity: decision === 'decline' || decision === 'cancel' ? 'Approval declined' : 'Approval accepted',
        codexError: '',
      });
    } catch (error) {
      set({ codexError: error instanceof Error ? error.message : 'Unable to respond to approval' });
    }
  },
}));

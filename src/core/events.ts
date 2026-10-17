import { ProjectEvent } from './types.js';

let eventSeq = 0;
const eventListeners = new Set<(ev: ProjectEvent) => void>();

export function currentEventSeq(): number {
  return eventSeq;
}

export function emitProjectEvent(ev: Omit<ProjectEvent, 'seq'>): ProjectEvent {
  const full: ProjectEvent = { ...ev, seq: ++eventSeq };
  for (const listener of eventListeners) {
    try {
      listener(full);
    } catch {
      // Ignore listener errors
    }
  }
  return full;
}

export function onProjectEvent(listener: (ev: ProjectEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

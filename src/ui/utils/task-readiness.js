const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export function getTaskReadiness(task, tasks) {
  if (task.status !== 'todo') return { ready: false, reason: `Status is ${task.status.replace('_', ' ')}` };
  const byId = new Map(tasks.map(item => [item.id.toLowerCase(), item]));
  const missing = (task.dependsOn || []).filter(id => !byId.has(id.toLowerCase()));
  const waiting = (task.dependsOn || [])
    .map(id => byId.get(id.toLowerCase()))
    .filter(item => item && item.status !== 'done' && item.status !== 'cancelled');
  if (missing.length || waiting.length) {
    const parts = [];
    if (missing.length) parts.push(`Unresolved dependencies: ${missing.join(', ')}`);
    if (waiting.length) parts.push(`Waiting for: ${waiting.map(item => `${item.id} (${item.status.replace('_', ' ')})`).join(', ')}`);
    return { ready: false, reason: parts.join('; ') };
  }
  return {
    ready: true,
    reason: task.dependsOn?.length ? `Dependencies resolved: ${task.dependsOn.join(', ')}` : 'No dependencies',
  };
}

export function getReadyTasks(tasks, candidates = tasks) {
  return candidates
    .filter(task => getTaskReadiness(task, tasks).ready)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) || a.id.localeCompare(b.id));
}

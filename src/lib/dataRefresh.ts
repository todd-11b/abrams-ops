export type RefreshTopic = 'jobs' | 'job_issues';

const listeners: Record<RefreshTopic, Set<() => void>> = {
  jobs: new Set(),
  job_issues: new Set(),
};

/**
 * Stands in for the Supabase realtime subscriptions the containment work
 * removed: writers announce a change and every mounted reader refetches.
 */
export function subscribeToRefresh(topic: RefreshTopic, onChange: () => void): () => void {
  listeners[topic].add(onChange);
  return () => { listeners[topic].delete(onChange); };
}

export function notifyRefresh(topic: RefreshTopic): void {
  for (const listener of [...listeners[topic]]) {
    try { listener(); } catch (err) { console.error(`[dataRefresh] ${topic} listener failed:`, err); }
  }
}

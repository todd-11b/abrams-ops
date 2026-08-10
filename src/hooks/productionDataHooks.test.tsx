import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJobs } from './useJobs';
import { useJob } from './useJob';
import { useJobIssues } from './useJobIssues';
import { useOpenIssueCounts } from './useOpenIssueCounts';
import { useChecklist } from './useChecklist';

const queryResult = vi.hoisted(() => ({ data: [], error: null }));
const from = vi.hoisted(() => vi.fn());
const subscribeToRefresh = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({ supabase: { from } }));
vi.mock('../lib/dataRefresh', () => ({ subscribeToRefresh, notifyRefresh: vi.fn() }));
vi.mock('./useActivityLog', () => ({ useActivityLog: () => ({ append: vi.fn() }) }));
vi.mock('../utils/ghlSync', () => ({
  syncStageScheduled: vi.fn(),
  syncStageInInstall: vi.fn(),
  syncStageJobComplete: vi.fn(),
}));

function queryBuilder() {
  const builder = {
    select: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    then: (resolve: (value: typeof queryResult) => void) => resolve(queryResult),
  };
  builder.select.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(queryResult);
  return builder;
}

describe('production data-hook lifecycle', () => {
  beforeEach(() => {
    from.mockReset();
    from.mockImplementation(() => queryBuilder());
    subscribeToRefresh.mockReset();
    subscribeToRefresh.mockReturnValue(vi.fn());
  });

  it('loads useJobs once after mount, subscribes once, refreshes, and cleans up', async () => {
    let refresh: (() => void) | undefined;
    const unsubscribe = vi.fn();
    subscribeToRefresh.mockImplementation((_topic, callback) => {
      refresh = callback;
      return unsubscribe;
    });

    const { unmount } = renderHook(() => useJobs());
    expect(from).not.toHaveBeenCalled();
    expect(subscribeToRefresh).toHaveBeenCalledTimes(1);

    await act(async () => { await Promise.resolve(); });
    expect(from).toHaveBeenCalledTimes(1);

    await act(async () => refresh?.());
    expect(from).toHaveBeenCalledTimes(2);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['useJob', () => useJob('job-1'), 2, 'jobs'],
    ['useJobIssues', () => useJobIssues('job-1'), 1, 'job_issues'],
    ['useOpenIssueCounts', () => useOpenIssueCounts(), 1, 'job_issues'],
  ] as const)('%s schedules one initial load and cleans up its subscription', async (_name, hook, queryCount, topic) => {
    const unsubscribe = vi.fn();
    subscribeToRefresh.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => hook());
    expect(from).not.toHaveBeenCalled();
    expect(subscribeToRefresh).toHaveBeenCalledWith(topic, expect.any(Function));

    await act(async () => { await Promise.resolve(); });
    expect(from).toHaveBeenCalledTimes(queryCount);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending checklist load when the job changes', async () => {
    const { rerender } = renderHook(({ jobId }) => useChecklist(jobId), {
      initialProps: { jobId: 'job-1' },
    });

    rerender({ jobId: 'job-2' });
    await act(async () => { await Promise.resolve(); });

    // One select plus first-run seed insertion for only the replacement job.
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('deduplicates a refresh that arrives before the initial async boundary', async () => {
    let refresh: (() => void) | undefined;
    subscribeToRefresh.mockImplementation((_topic, callback) => {
      refresh = callback;
      return vi.fn();
    });

    renderHook(() => useJobs());
    await act(async () => refresh?.());
    await act(async () => { await Promise.resolve(); });

    expect(from).toHaveBeenCalledTimes(1);
  });
});

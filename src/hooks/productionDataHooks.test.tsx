import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJobs } from './useJobs';
import { useJob } from './useJob';
import { useJobIssues } from './useJobIssues';
import { useOpenIssueCounts } from './useOpenIssueCounts';
import { useChecklist } from './useChecklist';

interface MockQueryResult {
  data: unknown;
  error: { message: string } | null;
}

const queryResult = vi.hoisted((): MockQueryResult => ({ data: [], error: null }));
const from = vi.hoisted(() => vi.fn());
const subscribeToRefresh = vi.hoisted(() => vi.fn());
const createSignedUrls = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    from,
    storage: { from: () => ({ createSignedUrls }) },
  },
}));
vi.mock('../lib/dataRefresh', () => ({ subscribeToRefresh, notifyRefresh: vi.fn() }));
vi.mock('./useActivityLog', () => ({ useActivityLog: () => ({ append: vi.fn() }) }));
vi.mock('../utils/ghlSync', () => ({
  syncStageScheduled: vi.fn(),
  syncStageInInstall: vi.fn(),
  syncStageJobComplete: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function queryBuilder(result: Promise<typeof queryResult> | typeof queryResult = queryResult) {
  const builder = {
    select: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    then: (
      resolve: (value: typeof queryResult) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  builder.select.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  builder.maybeSingle.mockReturnValue(Promise.resolve(result));
  return builder;
}

describe('production data-hook lifecycle', () => {
  beforeEach(() => {
    from.mockReset();
    from.mockImplementation(() => queryBuilder());
    subscribeToRefresh.mockReset();
    subscribeToRefresh.mockReturnValue(vi.fn());
    createSignedUrls.mockReset();
    createSignedUrls.mockResolvedValue(queryResult);
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

  it('prevents a superseded useJob request from committing after the current job', async () => {
    const oldJob = deferred<typeof queryResult>();
    const oldSpec = deferred<typeof queryResult>();
    const newJob = deferred<typeof queryResult>();
    const newSpec = deferred<typeof queryResult>();
    const results = [oldJob.promise, oldSpec.promise, newJob.promise, newSpec.promise];
    from.mockImplementation(() => queryBuilder(results.shift()));

    const { result, rerender } = renderHook(({ jobId }) => useJob(jobId), {
      initialProps: { jobId: 'job-old' },
    });
    await act(async () => { await Promise.resolve(); });
    rerender({ jobId: 'job-new' });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      newJob.resolve({ data: { job_id: 'job-new' }, error: null });
      newSpec.resolve({ data: { job_id: 'job-new', fence_type: 'new' }, error: null });
      await Promise.resolve();
    });
    expect(result.current.job?.job_id).toBe('job-new');

    await act(async () => {
      oldJob.resolve({ data: { job_id: 'job-old' }, error: null });
      oldSpec.resolve({ data: { job_id: 'job-old', fence_type: 'old' }, error: null });
      await Promise.resolve();
    });
    expect(result.current.job?.job_id).toBe('job-new');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not commit a useJobs response after unmount', async () => {
    const pending = deferred<typeof queryResult>();
    from.mockImplementation(() => queryBuilder(pending.promise));
    const { result, unmount } = renderHook(() => useJobs());
    await act(async () => { await Promise.resolve(); });
    unmount();

    await act(async () => {
      pending.resolve({ data: [{ job_id: 'stale-job' }], error: null });
      await Promise.resolve();
    });

    expect(result.current.jobs).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('prevents an in-flight checklist request from overwriting a replacement job', async () => {
    const oldChecklist = deferred<typeof queryResult>();
    const newChecklist = deferred<typeof queryResult>();
    const results = [oldChecklist.promise, newChecklist.promise];
    from.mockImplementation(() => queryBuilder(results.shift()));

    const { result, rerender } = renderHook(({ jobId }) => useChecklist(jobId), {
      initialProps: { jobId: 'job-old' },
    });
    await act(async () => { await Promise.resolve(); });
    rerender({ jobId: 'job-new' });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      newChecklist.resolve({
        data: [{ item_id: 'new-item', job_id: 'job-new', checked: false }],
        error: null,
      });
      await Promise.resolve();
    });
    await act(async () => {
      oldChecklist.resolve({
        data: [{ item_id: 'old-item', job_id: 'job-old', checked: false }],
        error: null,
      });
      await Promise.resolve();
    });

    expect(result.current.items.map((item) => item.item_id)).toEqual(['new-item']);
    expect(result.current.loading).toBe(false);
  });

  it('lets the newest open-issue refresh win over an older in-flight request', async () => {
    const oldCounts = deferred<typeof queryResult>();
    const newCounts = deferred<typeof queryResult>();
    const results = [oldCounts.promise, newCounts.promise];
    let refresh: (() => void) | undefined;
    from.mockImplementation(() => queryBuilder(results.shift()));
    subscribeToRefresh.mockImplementation((_topic, callback) => {
      refresh = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useOpenIssueCounts());
    await act(async () => { await Promise.resolve(); });
    act(() => { refresh?.(); });
    await act(async () => {
      newCounts.resolve({ data: [{ job_id: 'job-new' }], error: null });
      await Promise.resolve();
    });
    await act(async () => {
      oldCounts.resolve({ data: [{ job_id: 'job-old' }], error: null });
      await Promise.resolve();
    });

    expect(result.current.countsByJob).toEqual({ 'job-new': 1 });
  });

  it('abandons an old issue photo path after the job changes', async () => {
    const oldIssues = deferred<typeof queryResult>();
    const oldPhotos = deferred<typeof queryResult>();
    const newIssues = deferred<typeof queryResult>();
    const results = [oldIssues.promise, oldPhotos.promise, newIssues.promise];
    from.mockImplementation(() => queryBuilder(results.shift()));

    const { result, rerender } = renderHook(({ jobId }) => useJobIssues(jobId), {
      initialProps: { jobId: 'job-old' },
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      oldIssues.resolve({ data: [{ issue_id: 'old', photos: ['photo-old'], resolved: false }], error: null });
      await Promise.resolve();
    });

    rerender({ jobId: 'job-new' });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      newIssues.resolve({ data: [], error: null });
      await Promise.resolve();
    });
    await act(async () => {
      oldPhotos.resolve({ data: [{ photo_id: 'photo-old', url: '/job-photos/old.jpg' }], error: null });
      await Promise.resolve();
    });

    expect(result.current.issues).toEqual([]);
    expect(result.current.photoUrls).toEqual({});
    expect(result.current.loading).toBe(false);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

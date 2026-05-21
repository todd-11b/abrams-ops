import { describe, it, expect } from 'vitest';
import { shouldFireBlockNotification } from './notificationThrottle';

const now = new Date('2026-05-21T12:00:00Z').getTime();

describe('shouldFireBlockNotification', () => {
  it('does not fire before day 3', () => {
    const blockedAt = new Date(now - 2 * 86400_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, null, now)).toBe(false);
  });

  it('fires on day 3 if never notified', () => {
    const blockedAt = new Date(now - 3 * 86400_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, null, now)).toBe(true);
  });

  it('does not re-fire within 48h of last notification', () => {
    const blockedAt = new Date(now - 5 * 86400_000).toISOString();
    const lastNotif = new Date(now - 24 * 3600_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, lastNotif, now)).toBe(false);
  });

  it('re-fires after 48h since last notification', () => {
    const blockedAt = new Date(now - 5 * 86400_000).toISOString();
    const lastNotif = new Date(now - 49 * 3600_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, lastNotif, now)).toBe(true);
  });

  it('does not fire if blocked_at is null', () => {
    expect(shouldFireBlockNotification(null, null, now)).toBe(false);
  });
});

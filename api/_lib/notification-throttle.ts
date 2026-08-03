const INITIAL_DELAY_MS = 3 * 86400_000;    // 3 days
const REPEAT_INTERVAL_MS = 48 * 3600_000;  // 48 hours

export function shouldFireBlockNotification(
  blockedAt: string | null,
  lastNotificationAt: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!blockedAt) return false;
  const blockedMs = new Date(blockedAt).getTime();
  if (nowMs - blockedMs < INITIAL_DELAY_MS) return false;
  if (!lastNotificationAt) return true;
  const lastMs = new Date(lastNotificationAt).getTime();
  return nowMs - lastMs >= REPEAT_INTERVAL_MS;
}

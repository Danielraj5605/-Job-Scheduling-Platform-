import { prisma } from './lib/prisma';
import { getActiveJobCount } from './poller';

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Sends a heartbeat to the backend API every HEARTBEAT_INTERVAL_MS (default 10s).
 * Updates workers.last_heartbeat_at and inserts a worker_heartbeats row.
 * Per SPEC.md Section 7.
 */
export function startHeartbeat(workerId: string): void {
  const intervalMs = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '10000', 10);
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001/api/v1';

  console.log(`[Heartbeat] Starting heartbeat every ${intervalMs}ms for worker ${workerId}`);

  heartbeatInterval = setInterval(async () => {
    try {
      const activeJobCount = getActiveJobCount();

      // Update directly via Prisma (worker has direct DB access)
      await prisma.$transaction([
        prisma.worker.update({
          where: { id: workerId },
          data: { lastHeartbeatAt: new Date() },
        }),
        prisma.workerHeartbeat.create({
          data: { workerId, activeJobCount },
        }),
      ]);

      console.log(`[Heartbeat] ♥ Worker ${workerId} alive — active jobs: ${activeJobCount}`);
    } catch (err) {
      console.error('[Heartbeat] Failed to send heartbeat:', err);
    }
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('[Heartbeat] Stopped');
  }
}

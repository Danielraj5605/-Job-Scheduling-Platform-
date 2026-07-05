import { prisma } from './lib/prisma';
import { activeJobs } from './poller';
import { stopHeartbeat } from './heartbeat';

let isShuttingDown = false;
let pollIntervals: ReturnType<typeof setInterval>[] = [];

/**
 * Graceful shutdown handler per SPEC.md Section 8.
 *
 * On SIGTERM/SIGINT:
 * 1. Stop polling for new jobs.
 * 2. Wait (up to SHUTDOWN_TIMEOUT_MS) for in-flight jobs to finish.
 * 3. Mark the worker offline.
 * 4. Exit.
 *
 * If timeout expires, exit anyway — the reaper will clean up any remaining jobs.
 */
export function setupGracefulShutdown(workerId: string, intervals: ReturnType<typeof setInterval>[]): void {
  pollIntervals = intervals;

  const shutdownHandler = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Shutdown] Received ${signal} — beginning graceful shutdown`);

    // 1. Stop polling
    stopHeartbeat();
    for (const interval of pollIntervals) {
      clearInterval(interval);
    }
    console.log('[Shutdown] Stopped polling for new jobs');

    // 2. Wait for in-flight jobs with bounded timeout
    const timeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);
    const deadline = Date.now() + timeoutMs;

    while (activeJobs.size > 0 && Date.now() < deadline) {
      console.log(`[Shutdown] Waiting for ${activeJobs.size} in-flight job(s) to complete...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (activeJobs.size > 0) {
      console.warn(`[Shutdown] Timeout expired with ${activeJobs.size} job(s) still running — exiting anyway. Reaper will requeue them.`);
    } else {
      console.log('[Shutdown] All in-flight jobs completed');
    }

    // 3. Mark worker offline
    try {
      await prisma.worker.update({
        where: { id: workerId },
        data: { status: 'offline' },
      });
      console.log(`[Shutdown] Worker ${workerId} marked offline`);
    } catch (err) {
      console.error('[Shutdown] Failed to mark worker offline:', err);
    }

    await prisma.$disconnect();
    console.log('[Shutdown] Done. Goodbye 👋');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}

export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

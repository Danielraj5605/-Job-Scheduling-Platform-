import { prisma } from './lib/prisma';

/**
 * Reaper — runs every 30 seconds.
 * 1. Finds workers whose last_heartbeat_at is older than 30 seconds and marks them offline.
 * 2. Re-queues any 'claimed' or 'running' jobs assigned to those stale workers.
 *
 * Per SPEC.md Section 7.
 */
export async function runReaper(): Promise<void> {
  const staleCutoff = new Date(Date.now() - 30_000);

  // Find stale online workers
  const staleWorkers = await prisma.worker.findMany({
    where: {
      status: 'online',
      lastHeartbeatAt: { lt: staleCutoff },
    },
    select: { id: true, hostname: true },
  });

  if (staleWorkers.length === 0) return;

  console.log(`[Reaper] Found ${staleWorkers.length} stale worker(s):`, staleWorkers.map((w: { id: string; hostname: string }) => w.hostname));

  const staleWorkerIds = staleWorkers.map((w: { id: string; hostname: string }) => w.id);

  await prisma.$transaction(async (tx) => {
    // Mark stale workers offline
    await tx.worker.updateMany({
      where: { id: { in: staleWorkerIds } },
      data: { status: 'offline' },
    });

    // Requeue their claimed/running jobs
    const requeueResult = await tx.job.updateMany({
      where: {
        claimedBy: { in: staleWorkerIds },
        status: { in: ['claimed', 'running'] },
      },
      data: {
        status: 'queued',
        claimedBy: null,
        claimedAt: null,
        runAt: null,
      },
    });

    console.log(`[Reaper] Requeued ${requeueResult.count} job(s) from stale workers`);
  });
}

/**
 * Starts the reaper on a 30-second interval.
 * Returns the interval handle so it can be cleared on shutdown.
 */
export function startReaper(): ReturnType<typeof setInterval> {
  console.log('[Reaper] Starting stale-worker recovery loop (every 30s)');
  return setInterval(async () => {
    try {
      await runReaper();
    } catch (err) {
      console.error('[Reaper] Error during reaper run:', err);
    }
  }, 30_000);
}

import { prisma } from './lib/prisma';
import { executeJob } from './executor';

/**
 * Computes retry backoff delay per SPEC.md Section 6.
 *
 * fixed:       delay = base_delay_seconds
 * linear:      delay = base_delay_seconds * attempt_number
 * exponential: delay = min(base_delay_seconds * 2^(attempt_number - 1), max_delay_seconds)
 */
function computeBackoffDelay(
  strategy: string,
  baseDelaySeconds: number,
  maxDelaySeconds: number,
  attemptNumber: number
): number {
  switch (strategy) {
    case 'fixed':
      return baseDelaySeconds;
    case 'linear':
      return baseDelaySeconds * attemptNumber;
    case 'exponential':
      return Math.min(baseDelaySeconds * Math.pow(2, attemptNumber - 1), maxDelaySeconds);
    default:
      return baseDelaySeconds;
  }
}

/** Set of job IDs currently being executed by this worker instance */
const activeJobs = new Set<string>();

export function getActiveJobCount(): number {
  return activeJobs.size;
}

/**
 * Polls a single queue for an available job using the atomic claim query
 * from SPEC.md Section 5. Uses FOR UPDATE SKIP LOCKED in a single transaction.
 *
 * Returns true if a job was found and processed.
 */
export async function pollQueue(
  queueId: string,
  workerId: string,
  concurrencyLimit: number
): Promise<boolean> {
  // Respect concurrency limit: count running jobs in this queue
  const runningCount = await prisma.job.count({
    where: { queueId, status: { in: ['running', 'claimed'] } },
  });

  if (runningCount >= concurrencyLimit) {
    return false; // Queue at capacity
  }

  // ── Atomic claim query per SPEC.md Section 5 ──────────────────────────────
  // MUST use FOR UPDATE SKIP LOCKED — no application-level mutex.
  const claimedJobs = await prisma.$queryRaw<Array<{
    id: string;
    queue_id: string;
    type: string;
    payload: unknown;
    status: string;
    priority: number;
    attempt_count: number;
    max_attempts: number;
    retry_policy_id: string | null;
    cron_expression: string | null;
    batch_id: string | null;
    idempotency_key: string | null;
    run_at: Date | null;
    claimed_by: string | null;
    claimed_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>>`
    WITH candidate AS (
      SELECT id FROM jobs
      WHERE queue_id = ${queueId}::uuid
        AND status IN ('queued','scheduled')
        AND (run_at IS NULL OR run_at <= now())
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET status = 'claimed', claimed_by = ${workerId}::uuid, claimed_at = now(), updated_at = now()
    FROM candidate
    WHERE jobs.id = candidate.id
    RETURNING jobs.*;
  `;

  if (claimedJobs.length === 0) {
    return false; // No jobs available
  }

  const claimedJob = claimedJobs[0];
  activeJobs.add(claimedJob.id);

  // Fire-and-forget — run execution async without blocking the poll loop
  runJob(claimedJob, workerId).catch((err) => {
    console.error(`[Poller] Unhandled error running job ${claimedJob.id}:`, err);
  });

  return true;
}

async function runJob(job: { id: string; payload: unknown; attempt_count: number; max_attempts: number; retry_policy_id: string | null; queue_id: string }, workerId: string): Promise<void> {
  const startTime = Date.now();
  const attemptNumber = job.attempt_count + 1;

  // Create execution record
  const execution = await prisma.jobExecution.create({
    data: {
      jobId: job.id,
      workerId,
      attemptNumber,
      status: 'running',
    },
  });

  // Mark job as running
  await prisma.job.update({
    where: { id: job.id },
    data: { status: 'running', attemptCount: { increment: 1 } },
  });

  try {
    const payload = (typeof job.payload === 'object' && job.payload !== null)
      ? (job.payload as Record<string, unknown>)
      : {};

    const result = await executeJob(job.id, payload);
    const durationMs = Date.now() - startTime;

    if (result.success) {
      // ── Success path ───────────────────────────────────────────────────────
      await prisma.$transaction([
        prisma.jobExecution.update({
          where: { id: execution.id },
          data: { status: 'completed', finishedAt: new Date(), durationMs },
        }),
        prisma.job.update({
          where: { id: job.id },
          data: { status: 'completed' },
        }),
        // Write execution logs
        ...result.logs.map((log) =>
          prisma.jobLog.create({
            data: { jobExecutionId: execution.id, level: log.level, message: log.message },
          })
        ),
      ]);

      console.log(`[Worker] ✓ Job ${job.id} completed in ${durationMs}ms`);
    } else {
      // ── Failure path ───────────────────────────────────────────────────────
      await handleFailure(job, execution.id, workerId, result.errorMessage ?? 'Unknown error', result.errorStack, durationMs, result.logs);
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const durationMs = Date.now() - startTime;
    await handleFailure(job, execution.id, workerId, error.message, error.stack, durationMs, []);
  } finally {
    activeJobs.delete(job.id);
  }
}

async function handleFailure(
  job: { id: string; attempt_count: number; max_attempts: number; retry_policy_id: string | null; queue_id: string },
  executionId: string,
  _workerId: string,
  errorMessage: string,
  errorStack: string | undefined,
  durationMs: number,
  logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
): Promise<void> {
  // attempt_count was already incremented to current attempt; check if we can retry
  const currentAttemptCount = job.attempt_count + 1; // +1 because we incremented at start

  await prisma.jobExecution.update({
    where: { id: executionId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      durationMs,
      errorMessage,
      errorStack: errorStack ?? null,
    },
  });

  // Write logs
  if (logs.length > 0) {
    await prisma.jobLog.createMany({
      data: logs.map((log) => ({
        jobExecutionId: executionId,
        level: log.level,
        message: log.message,
      })),
    });
  }

  if (currentAttemptCount < job.max_attempts) {
    // ── Retry with backoff ─────────────────────────────────────────────────
    let delaySeconds = 30; // default
    let strategy = 'exponential';
    let baseDelay = 30;
    let maxDelay = 3600;

    if (job.retry_policy_id) {
      const policy = await prisma.retryPolicy.findUnique({ where: { id: job.retry_policy_id } });
      if (policy) {
        strategy = policy.strategy;
        baseDelay = policy.baseDelaySeconds;
        maxDelay = policy.maxDelaySeconds;
      }
    }

    delaySeconds = computeBackoffDelay(strategy, baseDelay, maxDelay, currentAttemptCount);
    const runAt = new Date(Date.now() + delaySeconds * 1000);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'queued',
        runAt,
        claimedBy: null,
        claimedAt: null,
      },
    });

    console.log(`[Worker] ✗ Job ${job.id} failed (attempt ${currentAttemptCount}/${job.max_attempts}). Retrying in ${delaySeconds}s`);
  } else {
    // ── Dead letter ────────────────────────────────────────────────────────
    const currentJob = await prisma.job.findUnique({ where: { id: job.id } });

    await prisma.$transaction([
      prisma.job.update({
        where: { id: job.id },
        data: { status: 'dead_letter', claimedBy: null, claimedAt: null },
      }),
      prisma.deadLetterJob.create({
        data: {
          originalJobId: job.id,
          queueId: job.queue_id,
          payload: currentJob?.payload ?? {},
          finalError: errorMessage,
          attemptCount: currentAttemptCount,
        },
      }),
    ]);

    console.log(`[Worker] ☠ Job ${job.id} exhausted ${currentAttemptCount} attempts — moved to dead letter`);
  }
}

export { activeJobs };

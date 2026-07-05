import { prisma } from './lib/prisma';

/**
 * Mock job executor — runs the job payload and decides success or failure.
 * Failure mode: set payload.shouldFail = true to force failure.
 * Configurable failure rate: set payload.failRate = 0.3 (30% random failure).
 *
 * Per SPEC.md Phase 2 requirement: "make failure mode configurable — e.g. payload.shouldFail flag"
 */
export interface ExecutionResult {
  success: boolean;
  errorMessage?: string;
  errorStack?: string;
  logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
}

export async function executeJob(
  jobId: string,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const logs: ExecutionResult['logs'] = [];

  logs.push({ level: 'info', message: `[Executor] Starting job ${jobId}` });
  logs.push({ level: 'info', message: `[Executor] Payload: ${JSON.stringify(payload)}` });

  // Simulate work duration
  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 500;
  await sleep(Math.min(durationMs, 10_000)); // cap at 10s

  // Explicit failure flag
  if (payload.shouldFail === true) {
    logs.push({ level: 'error', message: '[Executor] Job forced to fail via shouldFail flag' });
    return {
      success: false,
      errorMessage: 'Job explicitly configured to fail (shouldFail=true)',
      errorStack: new Error('shouldFail').stack,
      logs,
    };
  }

  // Random failure rate
  const failRate = typeof payload.failRate === 'number' ? payload.failRate : 0;
  if (failRate > 0 && Math.random() < failRate) {
    const err = new Error(`Random failure (failRate=${failRate})`);
    logs.push({ level: 'error', message: `[Executor] Random failure triggered: ${err.message}` });
    return {
      success: false,
      errorMessage: err.message,
      errorStack: err.stack,
      logs,
    };
  }

  logs.push({ level: 'info', message: `[Executor] Job ${jobId} completed successfully` });
  return { success: true, logs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

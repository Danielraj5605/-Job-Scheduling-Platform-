import 'dotenv/config';
import os from 'os';
import http from 'http';
import { prisma } from './lib/prisma';
import { pollQueue } from './poller';
import { startHeartbeat } from './heartbeat';
import { setupGracefulShutdown, isShutdownInProgress } from './shutdown';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '2000', 10);
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);

async function main(): Promise<void> {
  console.log('🔧 Distributed Job Scheduler — Worker Process Starting');
  console.log(`   Host: ${os.hostname()}`);
  console.log(`   Concurrency: ${WORKER_CONCURRENCY}`);
  console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Dummy HTTP server for Render free tier (Render requires web services to bind to a port)
  const port = process.env.PORT || 10001;
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Worker is running');
  }).listen(port, () => {
    console.log(`🌐 Dummy healthcheck server running on port ${port}`);
  });

  // Register this worker instance
  const worker = await prisma.worker.create({
    data: {
      hostname: `${os.hostname()}-${process.pid}`,
      concurrency: WORKER_CONCURRENCY,
      status: 'online',
    },
  });

  console.log(`✅ Registered as worker ${worker.id} (${worker.hostname})`);

  // Start heartbeat
  startHeartbeat(worker.id);

  // Load all active queues
  async function loadQueues() {
    return prisma.queue.findMany({
      where: { isPaused: false },
      select: { id: true, name: true, concurrencyLimit: true },
    });
  }

  const pollIntervals: ReturnType<typeof setInterval>[] = [];

  // Start polling loop
  const pollInterval = setInterval(async () => {
    if (isShutdownInProgress()) return;

    try {
      const queues = await loadQueues();
      await Promise.all(
        queues.map((queue: { id: string; name: string; concurrencyLimit: number }) =>
          pollQueue(queue.id, worker.id, queue.concurrencyLimit).catch((err) => {
            console.error(`[Poller] Error polling queue ${queue.name}:`, err);
          })
        )
      );
    } catch (err) {
      console.error('[Poller] Error in poll loop:', err);
    }
  }, POLL_INTERVAL_MS);

  pollIntervals.push(pollInterval);

  // Setup graceful shutdown
  setupGracefulShutdown(worker.id, pollIntervals);

  console.log(`🏃 Worker ${worker.id} polling every ${POLL_INTERVAL_MS}ms`);
}

main().catch((err) => {
  console.error('Fatal error starting worker:', err);
  process.exit(1);
});

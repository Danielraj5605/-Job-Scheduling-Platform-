import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /dashboard/overview
router.get('/overview', async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    total_queues,
    total_workers_online,
    completedLast24h,
    failedLast24h,
    throughputSeries,
  ] = await Promise.all([
    prisma.queue.count(),
    prisma.worker.count({ where: { status: 'online' } }),
    prisma.jobExecution.count({
      where: { status: 'completed', finishedAt: { gte: twentyFourHoursAgo } },
    }),
    prisma.jobExecution.count({
      where: { status: 'failed', finishedAt: { gte: twentyFourHoursAgo } },
    }),
    // Throughput series: completed per hour over last 24h
    prisma.$queryRaw<Array<{ timestamp: Date; completed_count: bigint }>>`
      SELECT
        date_trunc('hour', finished_at) AS timestamp,
        COUNT(*) AS completed_count
      FROM job_executions
      WHERE status = 'completed'
        AND finished_at >= ${twentyFourHoursAgo}
      GROUP BY date_trunc('hour', finished_at)
      ORDER BY timestamp ASC
    `,
  ]);

  res.json({
    total_queues,
    total_workers_online,
    jobs_last_24h: {
      completed: completedLast24h,
      failed: failedLast24h,
    },
    throughput_series: throughputSeries.map((row) => ({
      timestamp: row.timestamp,
      completed_count: Number(row.completed_count),
    })),
  });
});

export default router;

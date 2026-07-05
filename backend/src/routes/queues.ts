import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';

const router = Router({ mergeParams: true });
router.use(authenticate);

// GET /projects/:projectId/queues
router.get('/projects/:projectId/queues', async (req: AuthRequest, res: Response) => {
  const queues = await prisma.queue.findMany({
    where: { projectId: req.params.projectId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    include: { defaultRetryPolicy: true },
  });
  res.json(queues);
});

// POST /projects/:projectId/queues
const createQueueSchema = z.object({
  name: z.string().min(1),
  priority: z.number().int().optional().default(0),
  concurrency_limit: z.number().int().min(1).optional().default(5),
  retry_policy_id: z.string().uuid().optional(),
});

router.post('/projects/:projectId/queues', validate(createQueueSchema), async (req: AuthRequest, res: Response) => {
  const { name, priority, concurrency_limit, retry_policy_id } = req.body;

  const queue = await prisma.queue.create({
    data: {
      projectId: req.params.projectId,
      name,
      priority,
      concurrencyLimit: concurrency_limit,
      defaultRetryPolicyId: retry_policy_id ?? null,
    },
    include: { defaultRetryPolicy: true },
  });

  res.status(201).json(queue);
});

// GET /queues/:id (+ stats)
router.get('/queues/:id', async (req: AuthRequest, res: Response) => {
  const queue = await prisma.queue.findUnique({
    where: { id: req.params.id },
    include: { defaultRetryPolicy: true },
  });
  if (!queue) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found' } });
    return;
  }
  res.json(queue);
});

// PATCH /queues/:id
const patchQueueSchema = z.object({
  priority: z.number().int().optional(),
  concurrency_limit: z.number().int().min(1).optional(),
  is_paused: z.boolean().optional(),
});

// PATCH /queues/:id — requires admin or owner (pause/resume, concurrency changes)
router.patch('/queues/:id', validate(patchQueueSchema), requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { priority, concurrency_limit, is_paused } = req.body;

  const queue = await prisma.queue.update({
    where: { id: req.params.id },
    data: {
      ...(priority !== undefined && { priority }),
      ...(concurrency_limit !== undefined && { concurrencyLimit: concurrency_limit }),
      ...(is_paused !== undefined && { isPaused: is_paused }),
    },
    include: { defaultRetryPolicy: true },
  });

  res.json(queue);
});

// DELETE /queues/:id
router.delete('/queues/:id', async (req: AuthRequest, res: Response) => {
  await prisma.queue.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// GET /queues/:id/stats
router.get('/queues/:id/stats', async (req: AuthRequest, res: Response) => {
  const queueId = req.params.id;

  const [queued, running, completed, failed, dead_letter] = await Promise.all([
    prisma.job.count({ where: { queueId, status: 'queued' } }),
    prisma.job.count({ where: { queueId, status: 'running' } }),
    prisma.job.count({ where: { queueId, status: 'completed' } }),
    prisma.job.count({ where: { queueId, status: 'failed' } }),
    prisma.job.count({ where: { queueId, status: 'dead_letter' } }),
  ]);

  // Throughput: completed jobs in the last minute
  const oneMinAgo = new Date(Date.now() - 60_000);
  const recentExecutions = await prisma.jobExecution.count({
    where: {
      job: { queueId },
      status: 'completed',
      finishedAt: { gte: oneMinAgo },
    },
  });

  res.json({
    queued,
    running,
    completed,
    failed,
    dead_letter,
    throughput_per_min: recentExecutions,
  });
});

export default router;

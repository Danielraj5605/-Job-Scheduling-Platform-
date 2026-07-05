import { Router, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// ─── Rate limiter — POST /queues/:queueId/jobs only ──────────────────────────
// 100 submissions per minute per authenticated user (in-memory, no Redis needed)
const jobSubmissionLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 100,                      // max 100 requests per window
  keyGenerator: (req) => {
    // Key by user ID so each user gets their own independent counter
    return (req as AuthRequest).user?.id ?? req.ip ?? 'anon';
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many job submissions. Max 100 per minute per user — try again shortly.',
      },
    });
  },
  standardHeaders: true,   // Return RateLimit-* headers
  legacyHeaders: false,
});

// ─── POST /queues/:queueId/jobs ──────────────────────────────────────────────
const submitJobSchema = z.object({
  type: z.enum(['immediate', 'delayed', 'scheduled', 'recurring', 'batch']),
  payload: z.record(z.unknown()).default({}),
  run_at: z.string().datetime().optional(),
  cron_expression: z.string().optional(),
  jobs: z.array(z.object({
    payload: z.record(z.unknown()),
    run_at: z.string().datetime().optional(),
  })).optional(),
  idempotency_key: z.string().optional(),
  retry_policy_id: z.string().uuid().optional(),
  priority: z.number().int().optional().default(0),
});

router.post('/queues/:queueId/jobs', jobSubmissionLimiter, validate(submitJobSchema), async (req: AuthRequest, res: Response) => {
  const { type, payload, run_at, cron_expression, jobs: batchJobs, idempotency_key, retry_policy_id, priority } = req.body;
  const { queueId } = req.params;

  // Verify queue exists
  const queue = await prisma.queue.findUnique({ where: { id: queueId } });
  if (!queue) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Queue not found' } });
    return;
  }

  if (queue.isPaused) {
    res.status(409).json({ error: { code: 'QUEUE_PAUSED', message: 'Queue is paused' } });
    return;
  }

  // Idempotency check (only for non-batch)
  if (idempotency_key && type !== 'batch') {
    const existing = await prisma.job.findFirst({
      where: { idempotencyKey: idempotency_key, queueId },
    });
    if (existing) {
      res.json(existing);
      return;
    }
  }

  // Resolve retry policy: explicit > queue default
  const resolvedRetryPolicyId = retry_policy_id ?? queue.defaultRetryPolicyId ?? null;
  let maxAttempts = 5;
  if (resolvedRetryPolicyId) {
    const policy = await prisma.retryPolicy.findUnique({ where: { id: resolvedRetryPolicyId } });
    if (policy) maxAttempts = policy.maxAttempts;
  }

  // Determine initial status
  const getStatus = (runAt?: string): string => {
    if (!runAt) return 'queued';
    return new Date(runAt) > new Date() ? 'scheduled' : 'queued';
  };

  // ── BATCH ─────────────────────────────────────────────────────────────────
  if (type === 'batch') {
    if (!batchJobs || batchJobs.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'batch type requires jobs array' } });
      return;
    }

    const batchId = crypto.randomUUID();
    const created = await prisma.$transaction(
      batchJobs.map((j: { payload: object; run_at?: string }) =>
        prisma.job.create({
          data: {
            queueId,
            type: 'batch',
            payload: j.payload,
            status: getStatus(j.run_at),
            priority: priority ?? 0,
            runAt: j.run_at ? new Date(j.run_at) : null,
            batchId,
            retryPolicyId: resolvedRetryPolicyId,
            maxAttempts,
          },
        })
      )
    );

    res.status(201).json(created);
    return;
  }

  // ── RECURRING ────────────────────────────────────────────────────────────
  if (type === 'recurring') {
    if (!cron_expression) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'recurring type requires cron_expression' } });
      return;
    }

    // Create a ScheduledJob definition row
    const scheduledJob = await prisma.scheduledJob.create({
      data: {
        queueId,
        cronExpression: cron_expression,
        payloadTemplate: payload,
        isActive: true,
      },
    });

    // Also create one initial job row so the queue has a job to show
    const job = await prisma.job.create({
      data: {
        queueId,
        type: 'recurring',
        payload,
        status: 'queued',
        priority: priority ?? 0,
        cronExpression: cron_expression,
        retryPolicyId: resolvedRetryPolicyId,
        maxAttempts,
        idempotencyKey: idempotency_key ?? null,
      },
    });

    res.status(201).json({ job, scheduledJob });
    return;
  }

  // ── IMMEDIATE / DELAYED / SCHEDULED ──────────────────────────────────────
  const job = await prisma.job.create({
    data: {
      queueId,
      type,
      payload,
      status: getStatus(run_at),
      priority: priority ?? 0,
      runAt: run_at ? new Date(run_at) : null,
      retryPolicyId: resolvedRetryPolicyId,
      maxAttempts,
      idempotencyKey: idempotency_key ?? null,
    },
  });

  res.status(201).json(job);
});

// ─── GET /queues/:queueId/jobs ───────────────────────────────────────────────
router.get('/queues/:queueId/jobs', async (req: AuthRequest, res: Response) => {
  const { queueId } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;

  const where: any = { queueId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: { retryPolicy: true },
    }),
    prisma.job.count({ where }),
  ]);

  res.json({ data, page, total });
});

// ─── GET /jobs/:id ───────────────────────────────────────────────────────────
router.get('/jobs/:id', async (req: AuthRequest, res: Response) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      retryPolicy: true,
      executions: {
        orderBy: { attemptNumber: 'asc' },
        include: { logs: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    return;
  }
  res.json(job);
});

// ─── POST /jobs/:id/retry ────────────────────────────────────────────────────
router.post('/jobs/:id/retry', async (req: AuthRequest, res: Response) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    return;
  }

  if (!['failed', 'dead_letter'].includes(job.status)) {
    res.status(409).json({
      error: { code: 'INVALID_STATE', message: `Cannot retry a job with status '${job.status}'` },
    });
    return;
  }

  const updated = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      status: 'queued',
      attemptCount: 0,
      runAt: null,
      claimedBy: null,
      claimedAt: null,
    },
  });

  res.json(updated);
});

// ─── DELETE /jobs/:id ────────────────────────────────────────────────────────
router.delete('/jobs/:id', async (req: AuthRequest, res: Response) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    return;
  }

  if (['running', 'claimed'].includes(job.status)) {
    res.status(409).json({
      error: { code: 'INVALID_STATE', message: 'Cannot cancel a running or claimed job' },
    });
    return;
  }

  await prisma.job.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ─── GET /jobs/:jobId/executions ─────────────────────────────────────────────
router.get('/jobs/:jobId/executions', async (req: AuthRequest, res: Response) => {
  const executions = await prisma.jobExecution.findMany({
    where: { jobId: req.params.jobId },
    orderBy: { attemptNumber: 'asc' },
  });
  res.json(executions);
});

// ─── GET /executions/:id/logs ────────────────────────────────────────────────
router.get('/executions/:id/logs', async (req: AuthRequest, res: Response) => {
  const logs = await prisma.jobLog.findMany({
    where: { jobExecutionId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(logs);
});

export default router;

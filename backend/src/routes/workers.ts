import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// GET /workers
router.get('/', async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const workers = await prisma.worker.findMany({
    where: status ? { status } : undefined,
    orderBy: { startedAt: 'desc' },
  });
  res.json(workers);
});

// GET /workers/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const worker = await prisma.worker.findUnique({
    where: { id: req.params.id },
    include: {
      heartbeats: {
        orderBy: { recordedAt: 'desc' },
        take: 20,
      },
    },
  });
  if (!worker) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Worker not found' } });
    return;
  }
  res.json(worker);
});

// POST /workers/register
const registerSchema = z.object({
  hostname: z.string().min(1),
  concurrency: z.number().int().min(1).default(5),
});

router.post('/register', validate(registerSchema), async (req: AuthRequest, res: Response) => {
  const worker = await prisma.worker.create({
    data: {
      hostname: req.body.hostname,
      concurrency: req.body.concurrency,
      status: 'online',
    },
  });
  res.status(201).json(worker);
});

// POST /workers/:id/heartbeat
const heartbeatSchema = z.object({
  active_job_count: z.number().int().min(0),
});

router.post('/:id/heartbeat', validate(heartbeatSchema), async (req: AuthRequest, res: Response) => {
  const workerId = req.params.id;

  await prisma.$transaction([
    prisma.worker.update({
      where: { id: workerId },
      data: { lastHeartbeatAt: new Date() },
    }),
    prisma.workerHeartbeat.create({
      data: {
        workerId,
        activeJobCount: req.body.active_job_count,
      },
    }),
  ]);

  res.status(204).send();
});

// POST /workers/:id/deregister
router.post('/:id/deregister', async (req: AuthRequest, res: Response) => {
  await prisma.worker.update({
    where: { id: req.params.id },
    data: { status: 'offline' },
  });
  res.status(204).send();
});

export default router;

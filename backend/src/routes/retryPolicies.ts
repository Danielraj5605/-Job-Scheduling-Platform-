import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// GET /retry-policies
router.get('/', async (_req, res: Response) => {
  const policies = await prisma.retryPolicy.findMany({ orderBy: { name: 'asc' } });
  res.json(policies);
});

// POST /retry-policies
const createSchema = z.object({
  name: z.string().min(1),
  strategy: z.enum(['fixed', 'linear', 'exponential']),
  base_delay_seconds: z.number().int().min(1).default(30),
  max_delay_seconds: z.number().int().min(1).default(3600),
  max_attempts: z.number().int().min(1).default(5),
});

router.post('/', validate(createSchema), async (req: AuthRequest, res: Response) => {
  const policy = await prisma.retryPolicy.create({
    data: {
      name: req.body.name,
      strategy: req.body.strategy,
      baseDelaySeconds: req.body.base_delay_seconds,
      maxDelaySeconds: req.body.max_delay_seconds,
      maxAttempts: req.body.max_attempts,
    },
  });
  res.status(201).json(policy);
});

export default router;

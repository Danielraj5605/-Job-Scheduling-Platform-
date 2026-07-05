import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /queues/:queueId/dead-letter
router.get('/queues/:queueId/dead-letter', async (req: AuthRequest, res: Response) => {
  const deadLetterJobs = await prisma.deadLetterJob.findMany({
    where: { queueId: req.params.queueId },
    orderBy: { movedAt: 'desc' },
  });
  res.json(deadLetterJobs);
});

// POST /dead-letter/:id/requeue
router.post('/dead-letter/:id/requeue', async (req: AuthRequest, res: Response) => {
  const dlJob = await prisma.deadLetterJob.findUnique({
    where: { id: req.params.id },
    include: { originalJob: true },
  });

  if (!dlJob) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dead letter job not found' } });
    return;
  }

  // Restore the original job back to queued status
  const [job] = await prisma.$transaction([
    prisma.job.update({
      where: { id: dlJob.originalJobId },
      data: {
        status: 'queued',
        attemptCount: 0,
        runAt: null,
        claimedBy: null,
        claimedAt: null,
      },
    }),
    prisma.deadLetterJob.delete({ where: { id: req.params.id } }),
  ]);

  res.json(job);
});

export default router;

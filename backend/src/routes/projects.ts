import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';

const router = Router();
router.use(authenticate);

// GET /projects — list with pagination
router.get('/', async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const skip = (page - 1) * limit;

  // Find all orgs the user belongs to, then projects in those orgs
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.user!.id },
    select: { organizationId: true },
  });
  const orgIds = memberships.map((m) => m.organizationId);

  const [data, total] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: { in: orgIds } },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.project.count({ where: { organizationId: { in: orgIds } } }),
  ]);

  res.json({ data, page, total });
});

// POST /projects
const createProjectSchema = z.object({
  name: z.string().min(1),
  organization_id: z.string().uuid().optional(),
});

router.post('/', validate(createProjectSchema), async (req: AuthRequest, res: Response) => {
  const { name, organization_id } = req.body;
  const userId = req.user!.id;

  let orgId = organization_id;

  // If no org_id supplied, auto-create a personal org for this user
  if (!orgId) {
    const existingOrg = await prisma.organization.findFirst({
      where: { ownerId: userId },
    });

    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const newOrg = await prisma.organization.create({
        data: {
          name: `${req.user!.email}'s workspace`,
          ownerId: userId,
          members: { create: { userId, role: 'owner' } },
        },
      });
      orgId = newOrg.id;
    }
  } else {
    // Verify user is a member of this org
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a member of that organization' } });
      return;
    }
  }

  const project = await prisma.project.create({
    data: { name, organizationId: orgId },
  });

  res.status(201).json(project);
});

// GET /projects/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    return;
  }
  res.json(project);
});

// DELETE /projects/:id — requires admin or owner in the project's org
router.delete('/:id', requireRole('admin'), async (req: AuthRequest, res: Response) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;

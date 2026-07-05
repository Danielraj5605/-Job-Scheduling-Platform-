import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';

const router = Router();
router.use(authenticate);

// GET /organizations/:orgId/members — any member can view the member list
router.get('/:orgId/members', async (req: AuthRequest, res: Response) => {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: req.params.orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  res.json(members);
});

// POST /organizations/:orgId/members — invite a user by email; owner only
const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['member', 'admin']).default('member'), // owners can grant up to admin; owner is assigned at org creation only
});

router.post(
  '/:orgId/members',
  requireRole('owner'),
  validate(inviteMemberSchema),
  async (req: AuthRequest, res: Response) => {
    const { email, role } = req.body;
    const { orgId } = req.params;

    // Find the user by email (they must already be registered)
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: `No registered user found with email: ${email}` },
      });
      return;
    }

    // Upsert to handle re-inviting existing members (idempotent)
    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      update: { role },
      create: { organizationId: orgId, userId: user.id, role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.status(201).json(member);
  }
);

// DELETE /organizations/:orgId/members/:userId — remove a member; owner only
router.delete(
  '/:orgId/members/:userId',
  requireRole('owner'),
  async (req: AuthRequest, res: Response) => {
    const { orgId, userId } = req.params;

    // Prevent owners from removing themselves (would orphan the org)
    if (userId === req.user!.id) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Cannot remove yourself from the organization' },
      });
      return;
    }

    await prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    res.status(204).send();
  }
);

// PATCH /organizations/:orgId/members/:userId — change a member's role; owner only
const patchMemberSchema = z.object({
  role: z.enum(['member', 'admin']),
});

router.patch(
  '/:orgId/members/:userId',
  requireRole('owner'),
  validate(patchMemberSchema),
  async (req: AuthRequest, res: Response) => {
    const { orgId, userId } = req.params;
    const { role } = req.body;

    const member = await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.json(member);
  }
);

export default router;

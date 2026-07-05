import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from './auth';

// Role hierarchy — higher number = more privilege
const ROLE_RANK: Record<string, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

type Role = 'member' | 'admin' | 'owner';

/**
 * Resolves the organization_id for a given resource so we can look up
 * the requesting user's role in that org.
 *
 * Resolution order:
 *   1. req.params.orgId       — direct org routes
 *   2. req.params.projectId   — project-scoped routes
 *   3. req.params.id on a project route (DELETE /projects/:id)
 *   4. req.params.queueId     — queue-scoped job routes
 *   5. req.params.id on a queue route (PATCH /queues/:id)
 */
async function resolveOrgId(req: AuthRequest): Promise<string | null> {
  // Direct org param
  if (req.params.orgId) return req.params.orgId;

  // Project ID supplied directly (e.g., route is /projects/:projectId/queues)
  const projectId = req.params.projectId ?? (req.route?.path?.startsWith('/projects') ? req.params.id : null);
  if (projectId) {
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
    return p?.organizationId ?? null;
  }

  // Queue ID — resolve project → org
  const queueId = req.params.queueId ?? req.params.id;
  if (queueId) {
    const q = await prisma.queue.findUnique({
      where: { id: queueId },
      select: { project: { select: { organizationId: true } } },
    });
    return q?.project?.organizationId ?? null;
  }

  return null;
}

/**
 * Middleware factory.
 * requireRole('admin') → allows admin and owner.
 * requireRole('owner') → allows owner only.
 * requireRole('member') → allows all authenticated members.
 */
export function requireRole(minRole: Role) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    const orgId = await resolveOrgId(req);
    if (!orgId) {
      // If we can't resolve an org (e.g., resource doesn't exist), fall through to 404 in route handler
      next();
      return;
    }

    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: { role: true },
    });

    if (!membership) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a member of this organization' },
      });
      return;
    }

    const userRank = ROLE_RANK[membership.role] ?? -1;
    const requiredRank = ROLE_RANK[minRole];

    if (userRank < requiredRank) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires the '${minRole}' role or higher (your role: ${membership.role})`,
        },
      });
      return;
    }

    next();
  };
}

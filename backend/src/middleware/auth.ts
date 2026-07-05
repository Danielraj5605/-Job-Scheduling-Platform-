import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
}

/**
 * Verifies the Supabase JWT from the Authorization header.
 * On success, attaches the user profile to req.user.
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' },
      });
      return;
    }

    // Upsert profile row — creates it on first login after Supabase Auth registration
    const profile = await prisma.user.upsert({
      where: { id: data.user.id },
      update: { email: data.user.email ?? '' },
      create: {
        id: data.user.id,
        email: data.user.email ?? '',
        name: data.user.user_metadata?.name ?? null,
      },
    });

    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({
      error: { code: 'AUTH_ERROR', message: 'Authentication check failed' },
    });
  }
}

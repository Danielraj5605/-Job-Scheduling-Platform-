import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// POST /auth/register
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

router.post('/register', validate(registerSchema), async (req, res: Response) => {
  const { email, password, name } = req.body;

  // Pass name into Supabase user_metadata so it appears in the Auth dashboard too
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: name ?? null } },
  });

  if (error) {
    res.status(400).json({ error: { code: 'REGISTER_FAILED', message: error.message } });
    return;
  }

  if (!data.user) {
    res.status(400).json({ error: { code: 'REGISTER_FAILED', message: 'User creation failed' } });
    return;
  }

  // Always upsert the public.users profile row so the name is persisted
  // even if email confirmation is pending (data.session will be null in that case)
  const profile = await prisma.user.upsert({
    where: { id: data.user.id },
    update: { name: name ?? null },
    create: { id: data.user.id, email, name: name ?? null },
  });

  res.status(201).json({
    user: { id: profile.id, email: profile.email, name: profile.name },
    // token is null when Supabase email confirmation is required
    token: data.session?.access_token ?? null,
  });
});


// POST /auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/login', validate(loginSchema), async (req, res: Response) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    res.status(401).json({ error: { code: 'LOGIN_FAILED', message: 'Invalid credentials' } });
    return;
  }

  const profile = await prisma.user.findUnique({ where: { id: data.user.id } });

  res.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      name: profile?.name ?? null,
    },
    token: data.session.access_token,
  });
});

// GET /auth/me
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;

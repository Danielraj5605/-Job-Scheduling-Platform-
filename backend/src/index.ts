import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import queueRoutes from './routes/queues';
import jobRoutes from './routes/jobs';
import workerRoutes from './routes/workers';
import retryPolicyRoutes from './routes/retryPolicies';
import deadLetterRoutes from './routes/deadLetter';
import dashboardRoutes from './routes/dashboard';
import organizationRoutes from './routes/organizations';
import { errorHandler, notFound } from './middleware/errorHandler';
import { startReaper } from './reaper';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*', credentials: true }));
app.use(express.json());

// ─── Routes (all under /api/v1 per SPEC.md Section 9) ────────────────────────
const v1 = express.Router();

v1.use('/auth', authRoutes);
v1.use('/projects', projectRoutes);
v1.use('/', queueRoutes);           // /projects/:projectId/queues, /queues/:id, /queues/:id/stats
v1.use('/', jobRoutes);             // /queues/:queueId/jobs, /jobs/:id, /executions/:id/logs
v1.use('/workers', workerRoutes);
v1.use('/retry-policies', retryPolicyRoutes);
v1.use('/', deadLetterRoutes);      // /queues/:queueId/dead-letter, /dead-letter/:id/requeue
v1.use('/dashboard', dashboardRoutes);
v1.use('/organizations', organizationRoutes); // member management (owner only)

app.use('/api/v1', v1);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}/api/v1`);
  startReaper();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  server.close(() => process.exit(0));
});

export default app;

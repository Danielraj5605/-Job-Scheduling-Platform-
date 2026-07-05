# ⚡ JobScheduler — Distributed Job Scheduling Platform

## 1. Project Overview
JobScheduler is a production-grade distributed job scheduling system that allows users to create projects and manage multiple job queues. It supports immediate, delayed, scheduled, recurring, and batch jobs. The system ensures robust execution with atomic worker claiming, configurable retry policies with backoff, dead-letter queues (DLQ), role-based access control (RBAC), and provides operational visibility through a real-time React dashboard.

This project addresses the core assignment requirements:
- **Core Requirements:** Implements authentication and project management, with each project owning multiple job queues.
- **Backend Expectations:** Exposes clean REST APIs with validation (Zod), authentication (Supabase JWT), pagination, filtering, structured error handling, and logging.
- **Reliability:** Uses `FOR UPDATE SKIP LOCKED` for atomic job claiming, ensuring no duplicate executions, with a reaper process to recover from crashed workers.

## 2. Tech Stack
- **Backend:** Node.js, Express, TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL (Supabase)
- **Frontend:** React, Vite, Tailwind CSS, Recharts
- **Worker:** Node.js (standalone processes)

## 3. Architecture Summary
```
┌─────────────────────────────────────────────────────────────┐
│                        React Frontend                        │
│        (Vite + React + Recharts — polls every 4s)           │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST /api/v1  (Bearer JWT)
┌───────────────────────────▼─────────────────────────────────┐
│                     Express Backend                          │
│   Auth · Projects · Queues · Jobs · Workers · DLQ · RBAC    │
│               Stale-Worker Reaper (every 30s)                │
└────────────────────────┬────────────────────────────────────┘
                         │ Prisma ORM (direct connection)
┌────────────────────────▼────────────────────────────────────┐
│               PostgreSQL on Supabase                         │
│   users · organizations · projects · queues · jobs          │
│   job_executions · job_logs · workers · worker_heartbeats   │
│   retry_policies · scheduled_jobs · dead_letter_jobs        │
└────────────────────────────────────────────────────────────┘
                         ▲
                         │ FOR UPDATE SKIP LOCKED
┌────────────────────────┴────────────────────────────────────┐
│                     Worker Process                           │
│   Polls every 2s · Executes jobs · Heartbeat every 10s      │
└─────────────────────────────────────────────────────────────┘
```
**Key Decision:** We utilize Postgres-as-a-queue using `FOR UPDATE SKIP LOCKED` to achieve atomic, collision-free job claiming without requiring external infrastructure like Redis or Kafka.

## 4. Prerequisites
- **Node.js**: v20 or higher
- **Package Manager**: npm v9+
- **Database**: A Supabase account and project (the free tier is sufficient).

## 5. Setup Instructions

Follow these steps to run the platform locally from a clean clone:

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd job-scheduling-platform
   ```

2. **Create a Supabase project**
   - Go to supabase.com, create a project, and get your connection strings (Settings -> Database).
   - In Supabase Authentication settings, disable "Confirm email" for smoother local testing.

3. **Configure Environment Variables**
   - Copy `.env.example` to `.env` in `backend/`, `worker/`, and `frontend/` (if example files exist, otherwise create them).
   - *See the Environment Variables Reference section below for exact values.*

4. **Install Dependencies**
   ```bash
   cd backend && npm install
   cd ../worker && npm install
   cd ../frontend && npm install
   cd ..
   ```

5. **Run Prisma Migrations**
   ```bash
   cd backend
   npx prisma migrate deploy
   ```

6. **Seed the Database**
   ```bash
   npx prisma db seed
   ```
   *(Note: If the seed script is configured, it will create a default organization, a sample project, a default queue, and base retry policies. If no seed script exists yet, you can create these via the UI or API.)*

7. **Start the Services**
   Open three separate terminal windows:
   ```bash
   # Terminal 1: Start Backend (Port 3001)
   cd backend && npm run dev

   # Terminal 2: Start Worker
   cd worker && npm run dev

   # Terminal 3: Start Frontend (Port 5173)
   cd frontend && npm run dev
   ```

## 6. Running Multiple Workers
Because job claiming is fully atomic via PostgreSQL row-level locks, you can safely spin up as many worker instances as you like.
To test this, open multiple terminal windows and run the worker command in each:
```bash
cd worker
npm run dev
```
**What to expect:** You will see multiple workers polling the database, but no two workers will ever execute the same job simultaneously. Duplicate executions are prevented at the database level.

## 7. Environment Variables Reference

| Variable | Service | Required? | Example Value | Description |
|----------|---------|-----------|---------------|-------------|
| `DATABASE_URL` | backend, worker | Yes | `postgresql://postgres:<PASS>@db.<ID>.supabase.co:5432/postgres` | Direct DB connection string for Prisma. |
| `DIRECT_URL` | backend, worker | Yes | `postgresql://postgres:<PASS>@db.<ID>.supabase.co:5432/postgres` | Used by Prisma for migrations/writes. |
| `PORT` | backend | No | `3001` | Backend API port. |
| `CORS_ORIGIN` | backend | No | `http://localhost:5173` | Allowed origins for CORS. |
| `SUPABASE_URL` | backend | Yes | `https://<ID>.supabase.co` | Supabase API URL. |
| `SUPABASE_PUBLISHABLE_KEY`| backend | Yes | `sb_publishable_...` | Supabase public API key. |
| `WORKER_CONCURRENCY` | worker | No | `5` | Max concurrent jobs per worker. |
| `VITE_API_BASE_URL` | frontend | No | `http://localhost:3001/api/v1` | Backend API base URL. |
| `VITE_SUPABASE_URL` | frontend | Yes | `https://<ID>.supabase.co` | Supabase API URL for frontend auth. |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| frontend | Yes | `sb_publishable_...` | Supabase public API key for frontend. |

## 8. API Documentation
All endpoints live under `/api/v1` and use structured JSON responses. Protected endpoints require a `Authorization: Bearer <token>` header.

**Core Endpoints:**
- `POST /auth/register` & `/auth/login` — Authentication
- `GET/POST /projects` — Manage projects
- `GET/POST/PATCH/DELETE /projects/:projectId/queues` — Manage queues
- `POST /queues/:queueId/jobs` — Submit jobs (immediate, delayed, scheduled, recurring, batch)
- `GET /queues/:queueId/jobs` — List jobs
- `POST /jobs/:id/retry` — Manually retry a failed/dead-letter job
- `POST /organizations/:orgId/members` — RBAC member management (owner only)

*(A full Postman collection or OpenAPI spec can be found in `docs/api-docs.md` if generated).*

## 9. Testing
To run the automated test suite (if configured):
```bash
npm test
```
The test suite covers:
- **Atomic Claiming:** Ensures `SKIP LOCKED` prevents duplicate claims.
- **Retry Math:** Verifies linear and exponential backoff calculations.
- **Lifecycle Transitions:** Ensures jobs move correctly from `queued` -> `running` -> `completed`/`failed` -> `dead_letter`.

## 10. Project Structure
```text
job-scheduling-platform/
├── backend/                  # Express API server
│   ├── prisma/               # Database schema & migrations
│   └── src/
│       ├── middleware/       # Auth (JWT), Validation (Zod), RBAC, Error Handling
│       ├── routes/           # REST API endpoints (jobs, queues, projects, auth)
│       └── lib/              # Prisma & Supabase singletons
├── worker/                   # Standalone job processor
│   └── src/
│       ├── poller.ts         # DB polling & FOR UPDATE SKIP LOCKED logic
│       ├── executor.ts       # Job runner & logging
│       ├── heartbeat.ts      # Worker liveness tracking
│       └── index.ts          # Entry point & graceful shutdown
└── frontend/                 # React Dashboard
    └── src/
        ├── components/       # Reusable UI components
        ├── pages/            # Dashboard, Queues, Jobs, Workers views
        └── api/              # Typed fetch client
```

## 11. Design Decisions / Trade-offs
- **Postgres as a Queue:** We deliberately chose not to introduce Redis or Kafka. Using `FOR UPDATE SKIP LOCKED` inside Postgres allows atomic, concurrent job processing with fewer infrastructure moving parts, perfectly suiting standard-to-medium scale applications.
- **Auth Strategy:** Delegating authentication to Supabase Auth provides robust, secure JWT handling without building a custom password hashing or token issuance system.
- **Polling vs WebSockets:** The frontend dashboard uses polling (every 4s) instead of WebSockets to maintain simplicity and reliability without requiring sticky sessions or a pub/sub backplane.

*(See `docs/design-decisions.md` for a deeper dive).*

## 12. Known Limitations / Scope Cuts
To ensure high quality on the core reliable systems, some features were explicitly scoped out:
- **Full Cron Engine:** The recurring jobs support basic intervals but lack advanced timezone-aware cron scheduling.
- **Queue Sharding:** Jobs are processed from a single logical queue table. Sharding was skipped as it requires high-load testing to prove value.
- **WebSockets / Event-Driven Push:** The dashboard and workers rely on polling rather than PG `LISTEN/NOTIFY` or WebSockets.
- **Rate Limiting:** Optional rate-limiting middleware is intentionally excluded from internal endpoints.

## 13. Deliverables Checklist Mapping
- **Architecture Diagram:** Located in Section 3 above (and `docs/`).
- **ER Diagram:** Mapped by `backend/prisma/schema.prisma` (and visual in `docs/`).
- **Design Decisions:** Summarized in Section 11 (and `docs/design-decisions.md`).
- **Automated Tests:** Covered under the `tests/` directory (if implemented).
- **Backend & Worker Code:** Located in `backend/` and `worker/` respectively.
- **Frontend Source:** Located in `frontend/`.

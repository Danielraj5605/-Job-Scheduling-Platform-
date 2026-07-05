# Distributed Job Scheduler — Build Spec (v1)

This is the single source of truth for the project. Every AI coding tool
(Gemini CLI, Codex, Antigravity) should be given the relevant section(s)
of this file as context before generating code. Do not let any tool
invent its own schema, endpoint shapes, or state names — they must match
this document exactly, since backend/worker/frontend are built in
parallel and only agree if they share this contract.

---

## 1. Scope (Day-1 build)

**In scope:**
- Auth (JWT, simple)
- Projects → Queues → Jobs hierarchy
- Job types: immediate, delayed (`run_at` in the future), scheduled (`run_at` exact timestamp), recurring (cron string, basic parser), batch (array submit)
- Worker service: polling, atomic claim, concurrency limit per queue, heartbeats, graceful shutdown
- Full lifecycle + retries (fixed / linear / exponential backoff) + Dead Letter Queue
- Execution history + logs per job
- Dashboard: queues list, job explorer w/ filters, worker status, basic throughput chart, manual retry button

**Explicitly out of scope (mention as "designed for, not implemented" in the design doc):**
- Full cron scheduling engine (use a library, not hand-rolled)
- WebSockets (use polling every 3–5s)
- RBAC, rate limiting, distributed locking, sharding, workflow DAGs, AI summaries (pick at most one bonus if time remains)

---

## 2. Tech Stack

- **Backend:** Node.js + TypeScript + Express (or Fastify)
- **ORM:** Prisma
- **DB:** PostgreSQL 15+
- **Worker:** separate Node process, same codebase, different entrypoint
- **Frontend:** React + Vite + TypeScript + Tailwind + Recharts
- **Auth:** JWT (access token only, no refresh-token complexity needed)
- **Validation:** Zod
- **Testing:** Vitest / Jest for backend unit + integration tests

---

## 3. Database Schema

All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` unless noted.
Timestamps are `TIMESTAMPTZ`. Use `ON DELETE CASCADE` for ownership chains
(org → project → queue → job), `ON DELETE SET NULL` for worker references
on historical records (don't delete history when a worker is deprovisioned).

```sql
-- USERS
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ORGANIZATIONS
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  PRIMARY KEY (organization_id, user_id)
);

-- PROJECTS
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- QUEUES
CREATE TABLE queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,              -- higher = more urgent
  concurrency_limit INT NOT NULL DEFAULT 5,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  default_retry_policy_id UUID REFERENCES retry_policies(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, name)
);

-- RETRY POLICIES
CREATE TABLE retry_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('fixed','linear','exponential')),
  base_delay_seconds INT NOT NULL DEFAULT 30,
  max_delay_seconds INT NOT NULL DEFAULT 3600,
  max_attempts INT NOT NULL DEFAULT 5
);

-- JOBS (definition + current state)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES queues(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('immediate','delayed','scheduled','recurring','batch')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','scheduled','claimed','running','completed','failed','dead_letter')),
  priority INT NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ,                 -- null = run now; set for delayed/scheduled
  cron_expression TEXT,               -- set for recurring
  batch_id UUID,                      -- groups jobs submitted together
  idempotency_key TEXT,               -- optional, for safe re-submission
  retry_policy_id UUID REFERENCES retry_policies(id),
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  claimed_by UUID REFERENCES workers(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jobs_claim_candidates
  ON jobs (queue_id, status, priority DESC, created_at ASC)
  WHERE status IN ('queued','scheduled');

CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_idempotency_key ON jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- JOB EXECUTIONS (one row per attempt)
CREATE TABLE job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  error_message TEXT,
  error_stack TEXT
);

CREATE INDEX idx_executions_job_id ON job_executions (job_id);

-- JOB LOGS (free-form log lines per execution)
CREATE TABLE job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_execution_id UUID REFERENCES job_executions(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warn' | 'error'
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_logs_execution_id ON job_logs (job_execution_id);

-- WORKERS
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline','draining')),
  concurrency INT NOT NULL DEFAULT 5,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ DEFAULT now()
);

-- WORKER HEARTBEATS (optional history; workers table keeps only latest)
CREATE TABLE worker_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
  active_job_count INT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_heartbeats_worker_id ON worker_heartbeats (worker_id, recorded_at DESC);

-- SCHEDULED JOBS (recurring job definitions that spawn `jobs` rows)
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES queues(id) ON DELETE CASCADE,
  cron_expression TEXT NOT NULL,
  payload_template JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- DEAD LETTER QUEUE
CREATE TABLE dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES queues(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  final_error TEXT,
  attempt_count INT NOT NULL,
  moved_at TIMESTAMPTZ DEFAULT now()
);
```

**Design notes to put in your design-decisions doc:**
- `jobs` holds current state; `job_executions` holds history — never overwrite past attempts.
- Partial index on `jobs (queue_id, status, priority, created_at) WHERE status IN ('queued','scheduled')` keeps the claim-query index small and fast as completed jobs accumulate.
- `dead_letter_jobs` is a separate table (not just a status) so DLQ browsing/replaying doesn't scan the hot `jobs` table.
- Cascading: deleting a project cascades down to queues/jobs (ownership chain); deleting a worker nulls out `claimed_by` on history rows instead of deleting them (preserve audit trail).

---

## 4. Job Lifecycle State Machine

```
        submit
          │
          ▼
      ┌────────┐   run_at in future   ┌───────────┐
      │ queued │ ───────────────────► │ scheduled │
      └───┬────┘                      └─────┬─────┘
          │                                  │ run_at reached
          │◄─────────────────────────────────┘
          │
          ▼ worker claims (atomic)
      ┌─────────┐
      │ claimed │
      └────┬────┘
           ▼
      ┌─────────┐
      │ running │
      └────┬────┘
       success │ failure
     ┌─────────┴─────────┐
     ▼                   ▼
┌───────────┐     attempts < max?
│ completed │       │yes      │no
└───────────┘       ▼         ▼
              back to      ┌─────────────┐
              queued       │ dead_letter │
              (after       └─────────────┘
              backoff
              delay)
```

Every transition writes: new `status`, `updated_at`, and (for claim/run/finish)
a row in `job_executions`.

---

## 5. Atomic Claim Query (worker polling — use exactly this pattern)

```sql
BEGIN;

WITH candidate AS (
  SELECT id FROM jobs
  WHERE queue_id = $1
    AND status IN ('queued','scheduled')
    AND (run_at IS NULL OR run_at <= now())
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs
SET status = 'claimed', claimed_by = $2, claimed_at = now(), updated_at = now()
FROM candidate
WHERE jobs.id = candidate.id
RETURNING jobs.*;

COMMIT;
```

- `FOR UPDATE SKIP LOCKED` is mandatory — do not replace with an
  application-level mutex or a "SELECT then UPDATE WHERE status=queued"
  pattern (that has a race condition between the SELECT and UPDATE).
- Respect `concurrency_limit`: before running this query, the worker
  should check current `running` count for that queue and only poll
  if under the limit.

---

## 6. Retry / Backoff Formulas

```
fixed:       delay = base_delay_seconds
linear:      delay = base_delay_seconds * attempt_number
exponential: delay = min(base_delay_seconds * 2^(attempt_number - 1), max_delay_seconds)
```

On failure: increment `attempt_count`; if `attempt_count < max_attempts`,
set status back to `queued` with `run_at = now() + delay`; else move to
`dead_letter_jobs` and set job status `dead_letter`.

---

## 7. Heartbeats & Stale-Worker Recovery

- Worker updates `workers.last_heartbeat_at` every 10s (and inserts a row
  into `worker_heartbeats` with current active job count).
- A reaper job (runs every 30s, can live in the backend or worker) finds:
  ```sql
  SELECT * FROM workers WHERE last_heartbeat_at < now() - interval '30 seconds' AND status = 'online';
  ```
  marks them `offline`, and requeues any `claimed`/`running` jobs
  assigned to them (`status = 'queued'`, clear `claimed_by`).

## 8. Graceful Shutdown

On SIGTERM/SIGINT: worker stops polling for new jobs, waits (bounded
timeout, e.g. 30s) for in-flight jobs to finish, marks itself `offline`,
then exits. If timeout expires, exit anyway — the reaper will requeue
any jobs still marked running under this worker.

---

## 9. REST API Contract

Base URL: `/api/v1`. Auth via `Authorization: Bearer <jwt>` unless noted.
All list endpoints support `?page=&limit=` and relevant `?status=`/`?queue_id=` filters.
Errors: `{ "error": { "code": "STRING_CODE", "message": "human readable" } }` with appropriate HTTP status.

### Auth
```
POST   /auth/register        { email, password, name }        -> { user, token }
POST   /auth/login           { email, password }               -> { user, token }
GET    /auth/me                                                -> { user }
```

### Projects
```
GET    /projects                                               -> { data: Project[], page, total }
POST   /projects             { name }                          -> Project
GET    /projects/:id                                           -> Project
DELETE /projects/:id
```

### Queues
```
GET    /projects/:projectId/queues                             -> Queue[]
POST   /projects/:projectId/queues
  { name, priority?, concurrency_limit?, retry_policy_id? }    -> Queue
GET    /queues/:id                                              -> Queue (+ stats)
PATCH  /queues/:id           { priority?, concurrency_limit?, is_paused? } -> Queue
DELETE /queues/:id
GET    /queues/:id/stats                                       -> { queued, running, completed, failed, dead_letter, throughput_per_min }
```

### Jobs
```
POST   /queues/:queueId/jobs
  {
    type: "immediate" | "delayed" | "scheduled" | "recurring" | "batch",
    payload: object,
    run_at?: ISODate,          // delayed/scheduled
    cron_expression?: string,  // recurring
    jobs?: object[],           // batch: array of { payload, run_at? }
    idempotency_key?: string,
    retry_policy_id?: string
  }                                                              -> Job | Job[]

GET    /queues/:queueId/jobs      ?status=&page=&limit=          -> { data: Job[], page, total }
GET    /jobs/:id                                                 -> Job (+ executions[])
POST   /jobs/:id/retry                                           -> Job   (manual re-queue from failed/dead_letter)
DELETE /jobs/:id                                                 (cancel if not yet running)
```

### Executions & Logs
```
GET    /jobs/:jobId/executions                                   -> JobExecution[]
GET    /executions/:id/logs                                      -> JobLog[]
```

### Workers
```
GET    /workers                  ?status=                        -> Worker[]
GET    /workers/:id                                               -> Worker (+ recent heartbeats)
POST   /workers/register        { hostname, concurrency }         -> Worker   (called by worker process on boot)
POST   /workers/:id/heartbeat   { active_job_count }               -> 204
POST   /workers/:id/deregister                                     -> 204   (graceful shutdown)
```

### Dead Letter Queue
```
GET    /queues/:queueId/dead-letter                               -> DeadLetterJob[]
POST   /dead-letter/:id/requeue                                    -> Job   (moves back into jobs as 'queued')
```

### Retry Policies
```
GET    /retry-policies                                             -> RetryPolicy[]
POST   /retry-policies   { name, strategy, base_delay_seconds, max_delay_seconds, max_attempts } -> RetryPolicy
```

### Dashboard aggregate (optional convenience endpoint)
```
GET    /dashboard/overview   -> {
  total_queues, total_workers_online, jobs_last_24h: { completed, failed },
  throughput_series: [{ timestamp, completed_count }]
}
```

---

## 10. Folder Structure

```
job-scheduler/
├── backend/
│   ├── src/
│   │   ├── routes/          (auth, projects, queues, jobs, workers, retry-policies)
│   │   ├── services/        (job.service.ts, queue.service.ts, worker.service.ts, retry.service.ts)
│   │   ├── db/               (prisma schema, migrations)
│   │   ├── middleware/       (auth.ts, validate.ts, errorHandler.ts)
│   │   └── reaper.ts         (stale worker recovery — cron/interval)
│   ├── prisma/schema.prisma
│   └── tests/
├── worker/
│   ├── src/
│   │   ├── poller.ts         (claim loop per queue)
│   │   ├── executor.ts       (runs job payload, catches errors)
│   │   ├── heartbeat.ts
│   │   └── shutdown.ts
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── pages/            (Queues, JobExplorer, WorkerStatus, QueueDetail)
│   │   ├── components/
│   │   ├── api/               (typed API client matching section 9)
│   │   └── hooks/             (usePolling.ts)
├── docs/
│   ├── architecture-diagram.png
│   ├── er-diagram.png
│   ├── design-decisions.md
│   └── api-docs.md            (or OpenAPI spec)
└── README.md
```

---

## 11. Non-Functional / Review Checklist

- [ ] Job claim uses `FOR UPDATE SKIP LOCKED` — verified with a multi-worker test (spin 3 workers, submit 20 jobs, confirm exactly 20 executions total, no duplicates)
- [ ] All timestamps stored UTC
- [ ] Retry backoff capped by `max_delay_seconds`
- [ ] Idempotency key checked before creating a duplicate job when provided
- [ ] Reaper requeues jobs from workers with stale heartbeats
- [ ] Graceful shutdown drains in-flight jobs before exit
- [ ] Pagination on every list endpoint
- [ ] Structured error responses (no raw stack traces to client)
- [ ] Indexes match query patterns in section 3
- [ ] README documents: setup, env vars, `docker-compose up` (Postgres) if used, how to run backend/worker/frontend, how to run tests

---

## 12. Prompting Instructions for AI Tools

When handing a task to Gemini CLI / Codex / Antigravity, paste the
relevant section(s) above plus:

```
Constraints:
- Match the schema in SPEC.md section 3 exactly (do not rename fields or tables)
- Use the atomic claim query in section 5 verbatim — do not use application-level locks
- Match API contract in section 9 exactly (paths, request/response shapes)
- Do not add new dependencies without flagging it first
- Output file diffs only, then a one-line summary of what changed
```

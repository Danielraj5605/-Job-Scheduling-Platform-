# Database Schema — Distributed Job Scheduler

## What is a Database Schema?

A **database schema** is the blueprint of how your data is organized and
related — it defines every **table** (entity), every **column** (field) in
that table, the **data types**, the **keys** that identify and connect
records, and the **rules** (constraints) that keep the data valid.

Three things a schema captures:
1. **Structure** — what tables exist and what fields each one has
   (e.g., a `jobs` table has an `id`, `status`, `payload`, etc.)
2. **Relationships** — how tables connect to each other via
   **Primary Keys (PK)** and **Foreign Keys (FK)**. A PK uniquely
   identifies a row in its own table; an FK is a column that points to a
   PK in another table, creating a link (e.g., every `job` belongs to one
   `queue`, so `jobs.queue_id` is an FK pointing to `queues.id`).
3. **Constraints** — rules the database enforces automatically, like
   "status must be one of these 8 values" (`CHECK`), "this field can't be
   duplicated" (`UNIQUE`), or "delete all jobs if their queue is deleted"
   (`ON DELETE CASCADE`).

For this project, the schema is graded on its own (20/100 marks) because
it proves you understand **normalization** (not duplicating data across
tables), **indexing** (making common queries fast), and **cascade
behavior** (what happens to related data when something is deleted) —
not just whether the app "works."

This document is your reference for that schema: what each table is for,
why it exists, and how it connects to the rest.

---

## Entity Relationship Overview (plain-language map)

```
users ──< organization_members >── organizations ──< projects ──< queues ──< jobs
                                                                       │         │
                                                                       │         ├──< job_executions ──< job_logs
                                                                       │         │
                                                                       │         └──< dead_letter_jobs
                                                                       │
                                                                       └──< scheduled_jobs

workers ──< job_executions
workers ──< worker_heartbeats
retry_policies ──< queues (default policy)
retry_policies ──< jobs (per-job override)
```

Reading `A ──<  B` as **"one A has many B."**

---

## Tables

### 1. `users`
**What it is:** A person who can log in and manage projects/queues/jobs.
**Why it exists:** Every project belongs to an account; auth requires
identity.

**Using Supabase Auth (recommended):** Supabase manages its own
`auth.users` table (email, password hash, sessions) in a separate
`auth` schema that you don't touch directly. Your `public.users` table
becomes a **thin profile table** — no `password_hash` column needed —
linked 1:1 to `auth.users` by sharing the same `id`:

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | same value as `auth.users.id` (FK, not generated independently) |
| email | TEXT | denormalized copy, handy for joins/display without querying `auth` schema |
| name | TEXT | |
| created_at | TIMESTAMPTZ | |

Your backend verifies incoming requests by validating the Supabase JWT
(via `supabase.auth.getUser(token)` or JWKS verification), then uses the
`id` from that token to look up/join against `public.users` and
everything downstream (`organizations`, `projects`, etc.).

**If you'd rather hand-roll auth instead** (also valid — document
whichever you pick and why), use this version instead:

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| email | TEXT | UNIQUE, used for login |
| password_hash | TEXT | never store plaintext |
| name | TEXT | |
| created_at | TIMESTAMPTZ | |

---

### 2. `organizations`
**What it is:** A top-level account/workspace that owns projects — lets
multiple users share access to the same set of projects (e.g., a team).
**Why it exists:** Separates "who owns the billing/workspace" from
"who's a member with access," which is standard SaaS multi-tenancy
design and shows you thought beyond a single-user toy app.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT | |
| owner_id | UUID (FK → users.id) | creator/owner |
| created_at | TIMESTAMPTZ | |

### 2a. `organization_members` (join table)
**What it is:** Many-to-many link between `users` and `organizations`,
with a role attached.
**Why it exists:** A user can belong to multiple orgs, and an org has
multiple users — this can't be modeled with a simple FK on either side,
so it needs its own join table.

| Column | Type | Notes |
|---|---|---|
| organization_id | UUID (FK) | composite PK part 1 |
| user_id | UUID (FK) | composite PK part 2 |
| role | TEXT | 'owner' \| 'admin' \| 'member' |

---

### 3. `projects`
**What it is:** A named container that groups related queues (e.g.,
"Email Service," "Video Processing").
**Why it exists:** Lets one team manage several independent job systems
under one workspace without their queues colliding.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| organization_id | UUID (FK → organizations.id) | CASCADE delete |
| name | TEXT | |
| created_at | TIMESTAMPTZ | |

---

### 4. `queues`
**What it is:** A named lane of jobs with its own rules — priority,
how many jobs can run at once, default retry behavior, and whether
it's paused.
**Why it exists:** This is the core organizing unit for job processing.
Different job types (e.g., "send-email" vs "generate-report") usually
need different concurrency and retry behavior, so each gets its own
queue.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| project_id | UUID (FK → projects.id) | CASCADE delete |
| name | TEXT | UNIQUE per project |
| priority | INT | higher = processed first |
| concurrency_limit | INT | max jobs running at once |
| is_paused | BOOLEAN | pause/resume control |
| default_retry_policy_id | UUID (FK → retry_policies.id) | fallback if job has none |
| created_at | TIMESTAMPTZ | |

---

### 5. `retry_policies`
**What it is:** A reusable recipe for how failures are retried — which
backoff strategy, how long to wait, and how many attempts before giving up.
**Why it exists:** Instead of hardcoding retry numbers on every job,
policies are defined once and reused across queues/jobs — this is
**normalization**: don't repeat the same 4 numbers on every row.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | TEXT | e.g. "standard-exponential" |
| strategy | TEXT | 'fixed' \| 'linear' \| 'exponential' |
| base_delay_seconds | INT | starting delay |
| max_delay_seconds | INT | cap (matters for exponential) |
| max_attempts | INT | after this, job goes to DLQ |

---

### 6. `jobs`
**What it is:** The heart of the system — a unit of work, its current
status, and everything needed to run it.
**Why it exists:** Every feature in this project revolves around a job's
lifecycle, so this table needs to support fast lookups by status/queue
(hence the partial index — see "Indexing Notes" below).

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| queue_id | UUID (FK → queues.id) | CASCADE delete |
| type | TEXT | immediate \| delayed \| scheduled \| recurring \| batch |
| payload | JSONB | arbitrary job data (flexible schema-within-schema) |
| status | TEXT | queued → scheduled → claimed → running → completed/failed → dead_letter |
| priority | INT | overrides queue priority if needed |
| run_at | TIMESTAMPTZ | null = run now |
| cron_expression | TEXT | for recurring jobs |
| batch_id | UUID | groups jobs submitted together |
| idempotency_key | TEXT | prevents duplicate submission |
| retry_policy_id | UUID (FK) | overrides queue default if set |
| attempt_count | INT | how many times tried so far |
| max_attempts | INT | copied from policy at creation time |
| claimed_by | UUID (FK → workers.id) | which worker has it right now |
| claimed_at | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

**Why `payload` is JSONB, not fixed columns:** jobs can represent
anything ("send email," "resize image," "call webhook") — the shape of
their data isn't known in advance, so JSONB gives flexibility inside an
otherwise strict relational schema.

---

### 7. `job_executions`
**What it is:** A record of one *attempt* to run a job. If a job fails
and retries 3 times, that's 3 rows here, all pointing to the same job.
**Why it exists:** `jobs` only tracks *current* state — if you overwrote
it on every retry, you'd lose history (who ran it, when, why it failed
each time). Separating "current state" (`jobs`) from "history"
(`job_executions`) is a deliberate normalization choice worth explaining
in your design doc.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| job_id | UUID (FK → jobs.id) | CASCADE delete |
| worker_id | UUID (FK → workers.id) | SET NULL if worker deleted (keep history) |
| attempt_number | INT | 1, 2, 3... |
| status | TEXT | running \| completed \| failed |
| started_at / finished_at | TIMESTAMPTZ | |
| duration_ms | INT | for throughput metrics |
| error_message / error_stack | TEXT | for debugging failed attempts |

---

### 8. `job_logs`
**What it is:** Free-form log lines produced during a specific execution
attempt (e.g., "Connecting to SMTP server," "Retry limit reached").
**Why it exists:** Separated from `job_executions` because one execution
can produce many log lines — another one-to-many relationship, and
mixing them would force repeating execution metadata on every log line.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| job_execution_id | UUID (FK) | CASCADE delete |
| level | TEXT | info \| warn \| error |
| message | TEXT | |
| created_at | TIMESTAMPTZ | |

---

### 9. `workers`
**What it is:** A running process that claims and executes jobs.
**Why it exists:** You need to know which processes exist, whether
they're alive, and how much capacity they have — this is what makes
"atomic claiming" and "dead worker recovery" possible.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| hostname | TEXT | identifies the machine/process |
| status | TEXT | online \| offline \| draining |
| concurrency | INT | how many jobs it can run at once |
| started_at | TIMESTAMPTZ | |
| last_heartbeat_at | TIMESTAMPTZ | updated every ~10s |

---

### 10. `worker_heartbeats`
**What it is:** A history log of "I'm alive" pings from each worker,
including how many jobs it was running at that moment.
**Why it exists:** `workers.last_heartbeat_at` only tells you the *latest*
ping — this table lets you show a heartbeat history graph on the
dashboard and debug worker behavior over time.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| worker_id | UUID (FK) | CASCADE delete |
| active_job_count | INT | load at time of ping |
| recorded_at | TIMESTAMPTZ | |

---

### 11. `scheduled_jobs`
**What it is:** A *template* for recurring jobs — e.g., "every day at
midnight, create a job with this payload." This is different from a
`job` with `type = recurring`: this table is the cron definition itself,
which spawns actual rows in `jobs` each time it fires.
**Why it exists:** Separates "the recurring rule" from "each individual
run it produces" — without this split, you couldn't tell the difference
between the recurring schedule and one specific instance of it.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| queue_id | UUID (FK) | CASCADE delete |
| cron_expression | TEXT | e.g. "0 0 * * *" |
| payload_template | JSONB | copied into each spawned job |
| is_active | BOOLEAN | pause without deleting |
| last_run_at / next_run_at | TIMESTAMPTZ | for the scheduler loop |

---

### 12. `dead_letter_jobs`
**What it is:** A job that permanently failed (exhausted all retry
attempts), parked separately from the main `jobs` table.
**Why it exists (two reasons):**
1. **Query performance** — the main `jobs` table stays fast for
   claim-queries if permanently-failed jobs move out instead of
   accumulating with `status='dead_letter'` forever.
2. **Clarity** — DLQ browsing/replay is a distinct workflow from normal
   job processing, so it deserves its own table rather than being just
   another status.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| original_job_id | UUID (FK → jobs.id) | traceability |
| queue_id | UUID (FK) | |
| payload | JSONB | copied at time of failure |
| final_error | TEXT | last error message |
| attempt_count | INT | how many tries were made |
| moved_at | TIMESTAMPTZ | |

---

## Indexing Notes (why these specific indexes)

```sql
CREATE INDEX idx_jobs_claim_candidates
  ON jobs (queue_id, status, priority DESC, created_at ASC)
  WHERE status IN ('queued','scheduled');
```
This is the single most important index in the whole schema. Every
worker's polling query filters by `queue_id` + `status`, then sorts by
`priority` and `created_at` — this index matches that exact access
pattern. It's a **partial index** (the `WHERE` clause) so it only
indexes active jobs, not the millions of `completed` jobs that pile up
over time — keeping it small and fast indefinitely.

```sql
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_executions_job_id ON job_executions (job_id);
CREATE INDEX idx_logs_execution_id ON job_logs (job_execution_id);
CREATE INDEX idx_heartbeats_worker_id ON worker_heartbeats (worker_id, recorded_at DESC);
```
These support the dashboard's common lookups: "show me all jobs with
status X," "show me this job's execution history," "show me this
execution's logs," "show me this worker's recent heartbeats."

```sql
CREATE INDEX idx_jobs_idempotency_key ON jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
```
Speeds up the duplicate-submission check without penalizing jobs that
don't use idempotency keys at all.

---

## Cascade Behavior Summary

| When you delete... | What happens |
|---|---|
| an `organization` | all its `projects` cascade-delete |
| a `project` | all its `queues` cascade-delete |
| a `queue` | all its `jobs`, `scheduled_jobs`, `dead_letter_jobs` cascade-delete |
| a `job` | all its `job_executions` cascade-delete |
| a `job_execution` | all its `job_logs` cascade-delete |
| a `worker` | its `job_executions.worker_id` and `jobs.claimed_by` are **SET NULL**, not deleted — history is preserved even if the worker no longer exists |

The rule of thumb: **cascade down the ownership chain** (a queue can't
meaningfully exist without its project), but **never cascade-delete
history just because the actor (worker) is gone**.

---

## How to turn this into an ER diagram

1. Paste the SQL from `SPEC.md` (Section 3) into [dbdiagram.io](https://dbdiagram.io) (it accepts raw SQL under "Import").
2. Or, once you have a `schema.prisma` file generated from this doc, run:
   ```
   npx prisma generate
   ```
   with the `prisma-erd-generator` package added to `generator` blocks — it outputs a `.svg`/`.png` diagram automatically.
3. Export the diagram as an image and drop it into `docs/er-diagram.png` per the folder structure in `SPEC.md`.

---

## Running This Schema on Supabase

1. Create a free project at [supabase.com](https://supabase.com) — takes ~2 minutes to provision.
2. In **Project Settings → Database**, copy both connection strings:
   - **Connection pooling** (port 6543) → use as `DATABASE_URL`
   - **Direct connection** (port 5432) → use as `DIRECT_URL`
3. In `schema.prisma`:
   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")
     directUrl = env("DIRECT_URL")
   }
   ```
4. Run `npx prisma migrate dev --name init` — Prisma uses `DIRECT_URL` for the migration itself (required, since migrations need a direct session) and `DATABASE_URL` for normal app queries.
5. Point the **worker's** Prisma client at `DIRECT_URL` as well (not the pooled URL) — the atomic claim query needs a real transaction-holding connection, which the pooled connection (PgBouncer, transaction mode) doesn't reliably guarantee across statements.
6. If running multiple worker instances locally for your concurrency demo, add `?connection_limit=5` to each worker's connection string to avoid exhausting Supabase's free-tier connection cap.

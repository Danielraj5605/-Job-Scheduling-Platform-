# Bonus Features Plan

This document covers all 8 optional bonus features from the assignment.
None of these are required — the core scope in `SPEC.md` and
`IMPLEMENTATION_PLAN.md` already covers the 75/100 marks tied to
Architecture, DB Design, Backend, and Reliability. Treat this document
as a menu: only pull from it **after** the core Definition of Done
(`IMPLEMENTATION_PLAN.md` Section 5) is fully met and tested.

Each feature below includes: **what it is**, **how it works
conceptually**, **what you'd need to build**, and a **realistic effort
estimate** so you can decide what's worth attempting if time remains.

---

## Priority Order (if you attempt any, do them in this order)

| Priority | Feature | Effort | Why this order |
|---|---|---|---|
| 1 | Role-Based Access Control (RBAC) | 30–45 min | Schema already scaffolded (`organization_members.role`); just needs enforcement |
| 2 | Rate Limiting | 15–20 min | Single library, single middleware, easy to demo |
| 3 | Workflow Dependencies | 2–3 hrs | One new table + claim query change; meaningfully improves the "scheduler" story |
| 4 | Event-Driven Execution | 1–2 hrs | Achievable using Postgres LISTEN/NOTIFY, no new infra |
| 5 | WebSocket Live Updates | 1–2 hrs | Straightforward but replaces something (polling) that already works — lower marginal value |
| 6 | AI-Generated Failure Summaries | 1 hr | Easy technically (one API call) but least connected to the systems/reliability focus being graded |
| 7 | Distributed Locking (beyond DB-level) | 2–4 hrs | Requires new infra (Redis); higher effort, harder to justify without real multi-service coordination need |
| 8 | Queue Sharding | 4+ hrs | Significant redesign of the claim query and job routing; not realistic in a 1-day build |

**Recommendation:** if you only have 1–2 spare hours, do **RBAC + Rate
Limiting** only. They're cheap, functional, and demonstrate breadth
without risking your core reliability work.

---

## 1. Role-Based Access Control (RBAC)

### What it is
A system where different users have different permission levels within
an organization — e.g., an **owner** can delete projects and manage
billing, an **admin** can create/edit queues, and a **member** can only
view jobs and submit them, not change queue configuration.

### How it works
Every request that touches a protected resource checks the requesting
user's `role` (already stored in `organization_members.role`) before
allowing the action. This is enforced with **middleware** — a function
that runs before your route handler, inspects the authenticated user's
role for the relevant organization, and either lets the request through
or returns `403 Forbidden`.

```
Request → Auth middleware (who is this user?)
        → RBAC middleware (does this role allow this action?)
        → Route handler (do the actual work)
```

### What you'd need to build
- A `requireRole(minRole: 'member' | 'admin' | 'owner')` middleware
  function that:
  1. Looks up the user's `organization_members` row for the org tied
     to the resource in the request (e.g., via the project's
     `organization_id`)
  2. Compares their role against the minimum required (define an order:
     `member < admin < owner`)
  3. Rejects with `403` if insufficient
- Apply it to routes like:
  - `DELETE /projects/:id` → requires `admin` or `owner`
  - `PATCH /queues/:id` (pause/resume, concurrency changes) → requires `admin` or `owner`
  - `POST /queues/:queueId/jobs` → any role (`member` and up) can submit jobs
  - Invite/remove organization members → `owner` only

### Suggested schema addition
None needed — `organization_members.role` already exists in
`DATABASE_SCHEMA.md`. This is why it's priority #1: the data model is
already there, you're just adding enforcement logic.

### Effort: 30–45 minutes

---

## 2. Rate Limiting

### What it is
A safeguard that limits how many requests a single user/IP/API key can
make in a given time window — e.g., "max 100 job submissions per minute
per project" — to prevent abuse or accidental flooding (like a buggy
client submitting jobs in an infinite loop).

### How it works
A middleware tracks request counts in a time window (in-memory for a
demo, or Redis for production) keyed by something identifying the
caller (user ID, IP, or project ID). When the count exceeds the limit
within the window, subsequent requests get rejected with
`429 Too Many Requests` until the window resets.

```
Request → Rate limit middleware
            → check counter for this key in current window
            → under limit? increment counter, proceed
            → over limit? reject with 429 + Retry-After header
```

### What you'd need to build
- Install `express-rate-limit` (in-memory store is fine for a demo —
  no Redis needed unless you want it to survive server restarts)
- Apply it specifically to the job submission endpoint
  (`POST /queues/:queueId/jobs`), since that's the most abuse-prone
  route (someone could flood your queue with junk jobs)
- Example limit: 100 requests per minute per authenticated user
- Return a clear error body matching your existing error format:
  `{ "error": { "code": "RATE_LIMITED", "message": "Too many job submissions, try again in X seconds" } }`

### Where NOT to apply it
Don't rate-limit the worker's internal claim queries or heartbeat
endpoint — this feature is about protecting the **public API** from
abuse, not throttling your own internal machinery.

### Effort: 15–20 minutes

---

## 3. Workflow Dependencies (Job B runs after Job A)

### What it is
The ability to chain jobs so one only runs after another has
successfully completed — e.g., "resize image" must finish before
"upload thumbnail" starts. This turns the scheduler from a flat list of
independent jobs into something that can express **workflows** (small
DAGs — directed acyclic graphs).

### How it works
Add a dependency relationship between jobs. When a worker looks for
jobs to claim, it must **skip any job whose dependencies haven't
completed yet**, even if that job is otherwise `queued`. Once a job
completes, you check whether any *other* jobs were waiting on it and,
if all of their dependencies are now satisfied, they become eligible
for claiming.

```
Job A (queued) ──depends on──> nothing → immediately eligible
Job B (queued) ──depends on──> Job A   → NOT eligible until Job A = completed
```

### Suggested schema addition
```sql
CREATE TABLE job_dependencies (
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  depends_on_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, depends_on_job_id)
);
```
This is a many-to-many self-join on `jobs` — a job can depend on
multiple other jobs, and multiple jobs can depend on the same one.

### What you'd need to build
1. When submitting a job with a `depends_on: [job_id, ...]` field,
   insert rows into `job_dependencies`.
2. **Modify the atomic claim query** (SPEC.md Section 5) to exclude
   jobs with unmet dependencies:
   ```sql
   WHERE queue_id = $1
     AND status IN ('queued','scheduled')
     AND (run_at IS NULL OR run_at <= now())
     AND NOT EXISTS (
       SELECT 1 FROM job_dependencies jd
       JOIN jobs dep ON dep.id = jd.depends_on_job_id
       WHERE jd.job_id = jobs.id
         AND dep.status != 'completed'
     )
   ```
3. Add a `blocked` status (or reuse `queued` but make it invisible to
   the claim query until dependencies clear — simpler, fewer status
   values to manage).
4. **Watch for cycles.** If you allow arbitrary dependency graphs,
   validate at submission time that adding this dependency doesn't
   create a cycle (A depends on B, B depends on A) — otherwise those
   jobs can never run. A simple check: walk the dependency chain from
   the new dependency backwards and reject if you reach the original
   job.

### Effort: 2–3 hours (schema + claim query change + cycle validation + testing)

---

## 4. Event-Driven Execution

### What it is
Instead of workers **polling** the database every second or two asking
"is there a job for me?", the database **pushes a notification** the
moment a new job becomes available, so workers can react immediately
rather than waiting for their next poll cycle.

### How it works
PostgreSQL has a built-in pub/sub mechanism: `LISTEN` / `NOTIFY`. A
worker opens a persistent connection and `LISTEN`s on a channel (e.g.,
`new_job`). Whenever a job is inserted or becomes eligible to run, the
backend (or a database trigger) issues `NOTIFY new_job`. Every
listening worker instantly receives that notification and immediately
attempts to claim — rather than discovering the job on their next
polling tick.

```
Job inserted → trigger fires → NOTIFY 'new_job'
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
               Worker 1         Worker 2         Worker 3
             (listening)      (listening)      (listening)
                    │                │                │
              all race to claim — only one wins (SKIP LOCKED still required)
```

**Important:** this doesn't replace atomic claiming — it's purely a
latency optimization. `NOTIFY` just tells workers "go check now" faster
than their next poll interval would have. `FOR UPDATE SKIP LOCKED` is
still what prevents duplicate execution.

### What you'd need to build
1. A Postgres trigger on `INSERT` into `jobs` (and on `UPDATE` when a
   job's `run_at` passes or a dependency clears):
   ```sql
   CREATE OR REPLACE FUNCTION notify_new_job() RETURNS trigger AS $$
   BEGIN
     PERFORM pg_notify('new_job', NEW.queue_id::text);
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER job_inserted
   AFTER INSERT ON jobs
   FOR EACH ROW EXECUTE FUNCTION notify_new_job();
   ```
2. In the worker, alongside your existing polling loop (keep polling as
   a fallback — don't remove it, since `NOTIFY` messages are not
   persisted and are lost if no one's listening at the moment they
   fire), add a `LISTEN new_job` connection that triggers an immediate
   claim attempt when a notification arrives.
3. Reduce your polling interval as a fallback safety net (e.g., every
   10–15s instead of every 1–2s) since `NOTIFY` now handles the
   common case.

### Effort: 1–2 hours (requires a raw `pg` client connection alongside Prisma, since Prisma doesn't natively support LISTEN/NOTIFY)

---

## 5. WebSocket Live Updates

### What it is
Replacing the dashboard's polling (re-fetching every 3–5 seconds) with
a persistent connection that pushes updates to the browser the instant
something changes — job status flips, a worker goes offline, etc.

### How it works
The backend opens a WebSocket server (e.g., via `socket.io` or the
native `ws` library). Whenever a job's status changes, a worker's
heartbeat updates, or a job moves to the DLQ, the backend emits an
event over the socket to connected dashboard clients, which update
their UI immediately without waiting for a poll cycle.

```
Job status changes in DB
        │
        ▼
Backend emits socket event: { type: 'job_updated', jobId, newStatus }
        │
        ▼
Connected dashboard clients update their local state instantly
```

### What you'd need to build
1. Add `socket.io` (or `ws`) to the backend, initialized alongside
   Express.
2. Emit events from wherever job/worker state changes happen (job
   claim, completion, failure, DLQ move, heartbeat).
3. On the frontend, connect via `socket.io-client`, listen for events,
   and update local state (e.g., React state or a small store) instead
   of re-fetching on an interval.
4. Keep a polling fallback for initial page load / reconnect scenarios.

### Effort: 1–2 hours

### Honest note
This is technically straightforward, but it's **replacing something
that already works** (polling) rather than adding new capability. Given
the rubric weight (Frontend is only 10/100), this has the lowest
marginal value of the "easy" bonus features — do RBAC and rate limiting
first.

---

## 6. AI-Generated Failure Summaries

### What it is
When a job fails (especially after exhausting retries and landing in
the DLQ), instead of showing a raw stack trace, an LLM call generates a
plain-English summary of what likely went wrong — useful for a
dashboard where non-engineers might be triaging failures.

### How it works
When a job execution fails, its `error_message`/`error_stack` is sent
to an LLM API (e.g., the Claude API, since you already have API access
patterns available) with a prompt like "Summarize this error in one
sentence for a non-technical reader." The response is stored and shown
in the job detail view alongside the raw error.

```
Job fails → error_message/error_stack captured
        → sent to LLM API with a summarization prompt
        → summary stored (new column or separate table)
        → shown in dashboard job detail view
```

### What you'd need to build
- An API key for an LLM provider (Anthropic API, OpenAI, etc.)
- A small service function: `summarizeFailure(errorMessage, errorStack) → string`
- Call it either synchronously right after a failure is recorded, or
  asynchronously via a small background job (don't block the worker's
  main loop waiting on an external API call)
- Add a column to `job_executions`: `ai_failure_summary TEXT NULL`
- Display it in the frontend's job detail view, clearly labeled as
  AI-generated (don't present it as ground truth — it's a convenience
  summary, not a diagnosis)

### Effort: ~1 hour (mostly wiring — the summarization prompt itself is simple)

### Honest note
This is the bonus feature **least connected to what's actually being
graded** (systems architecture, DB design, concurrency/reliability). It
demos well but doesn't demonstrate engineering depth the way RBAC or
workflow dependencies do. Only worth it if you've already done
everything else and want a visual "wow" feature for a demo.

---

## 7. Distributed Locking (beyond database-level)

### What it is
A mechanism for coordinating exclusive access to a resource **across
multiple independent services or processes**, typically using an
external system like Redis (via the Redlock algorithm) — not just
within a single database's transactions.

### Why this is different from what you already have
Your atomic claim query (`FOR UPDATE SKIP LOCKED`) already solves "don't
let two workers run the same job" — but that's **database-level
locking**, scoped to one Postgres instance. "Distributed locking" as a
named bonus feature typically implies something like: "if we had
multiple independent backend services (not just workers) that all
needed to briefly hold an exclusive lock on some non-database resource
— like a shared file, a rate-limit budget, or a leader-election flag
for the reaper process — how would they coordinate without a shared
transaction?"

### How it works (if you want a real example that fits this project)
Use a **distributed lock for leader election on the reaper job**. If
you ever ran multiple backend instances (for scaling), you wouldn't
want every instance running its own stale-worker-reaper every 30
seconds — they'd all try to requeue the same jobs redundantly. Instead,
only one instance should hold the "I'm the reaper right now" lock at a
time.

```
Backend instance A → tries to acquire lock "reaper-lock" in Redis (with TTL)
Backend instance B → tries the same → fails, someone else holds it
                    → waits, retries after TTL expires
Only the lock holder runs the reaper sweep this cycle
```

### What you'd need to build
- Add Redis (a new piece of infrastructure — this is why it's a bigger
  lift than the others)
- Use a library like `redlock` or a simple `SET key value NX PX <ttl>`
  pattern (Redis's atomic "set if not exists with expiry")
- Wrap your reaper's execution in an acquire/release lock cycle

### Effort: 2–4 hours (new infra to provision + integrate + test)

### Honest note
This only meaningfully demonstrates something if you actually run
**multiple backend instances** in your demo — with a single backend
instance (which is realistic for a 1-day build), this feature has
nothing real to coordinate, and would just be decorative. Skip unless
you specifically want to demo horizontal backend scaling too.

---

## 8. Queue Sharding

### What it is
Splitting a single logical queue's jobs across multiple physical
partitions (shards) so that at very high volume, no single database
table/index becomes a bottleneck — each shard can be queried and locked
independently, increasing claim throughput.

### How it works
Instead of one `jobs` table where all workers compete for rows in the
same index, jobs for a queue are distributed (e.g., by a hash of
`job_id` or round-robin) across N physical partitions. Workers are
assigned to specific shards, so they're only ever contending with a
fraction of the other workers for locks, not all of them.

```
Queue "email-sending" (logical)
   ├── shard 0 (jobs table partition) → Workers 1, 2
   ├── shard 1 (jobs table partition) → Workers 3, 4
   └── shard 2 (jobs table partition) → Workers 5, 6
```

### What you'd need to build
- PostgreSQL native table partitioning on `jobs` (by hash or range)
- Logic to route a new job to the correct shard on submission
- Worker assignment logic (which workers poll which shard)
- Rebalancing logic if you want shards to handle uneven load (complex)

### Effort: 4+ hours, realistically more — this touches your schema,
claim query, worker assignment, and submission logic simultaneously.

### Honest note
This is **not realistic to implement meaningfully in a 1-day build**,
and more importantly, it's hard to demonstrate: sharding only proves
its value under high load/throughput, which you won't be generating in
a demo with a handful of test jobs. If you want credit for
understanding this concept without building it, write a paragraph in
`design-decisions.md` explaining how you *would* shard the `jobs` table
if volume required it (by queue_id hash, most likely) — that
demonstrates the knowledge without costing you build time you don't
have.

---

## Summary Table

| Feature | Real infra needed? | Demoable in a short demo? | Recommended for 1-day build? |
|---|---|---|---|
| RBAC | No | Yes | ✅ Yes |
| Rate Limiting | No | Yes | ✅ Yes |
| Workflow Dependencies | No | Yes | ✅ If time remains |
| Event-Driven Execution | No (uses Postgres LISTEN/NOTIFY) | Somewhat (latency improvement is subtle to show) | ⚠️ Only if core is rock solid early |
| WebSocket Live Updates | No | Yes | ⚠️ Low marginal value — polling already works |
| AI Failure Summaries | Yes (LLM API key) | Yes, demos well visually | ⚠️ Only as a last "wow" addition |
| Distributed Locking (Redis) | Yes (Redis) | Only if multi-instance backend demoed | ❌ Skip |
| Queue Sharding | No new infra, but major schema change | No — needs load to prove value | ❌ Skip; write about it instead |

# Implementation Plan, System Structure & Tech Stack
## Distributed Job Scheduler — One-Day Build

---

## 1. Tech Stack (final)

| Layer | Choice | Why |
|---|---|---|
| Backend language/framework | Node.js + TypeScript + Express | Fast to scaffold, huge ecosystem, AI tools generate it reliably |
| ORM | Prisma | Type-safe, generates migrations + ER diagram, easy to hand to AI tools with a clear schema file |
| Database | **Supabase (managed PostgreSQL 15+)** | Postgres under the hood — `FOR UPDATE SKIP LOCKED`, JSONB, partial indexes all work identically; zero local setup, live in ~2 minutes |
| Worker | Node.js (same repo, separate entrypoint/process) | Reuses Prisma client + types from backend, no second stack to maintain |
| Cron parsing (recurring jobs) | `node-cron` or `cron-parser` (library, not hand-rolled) | Don't burn hours writing cron math |
| Frontend | React + Vite + TypeScript | Fastest dev loop, AI tools are very fluent in it |
| Styling | Tailwind CSS | No design system to build from scratch |
| Charts | Recharts | Simple, works well with polled data |
| Auth | **Supabase Auth** (or JWT/bcrypt if you prefer full control) | Saves you the register/login/hash implementation time — see note below |
| Validation | Zod | Shared schemas between routes and (optionally) frontend forms |
| Realtime updates | Polling (`setInterval`, 3–5s) | WebSockets are a bonus, not worth the time today |
| Testing | Vitest (or Jest) + Supertest | Fast unit + integration tests for backend |
| Containerization (optional, nice for "setup instructions") | Docker Compose for Postgres only | Avoids "works on my machine" DB setup issues for graders |
| Diagramming | dbdiagram.io / prisma-erd-generator, and Excalidraw or draw.io for architecture diagram | Fast, no design skill needed |

**Rule for today:** if a tool isn't in this table, don't introduce it mid-build. Every new dependency costs you debugging time you don't have.

### 1.1 Supabase-specific notes

- **Two connection strings, use the right one for each purpose:**
  - **Direct connection (port 5432)** — use this for the **worker** and any **backend transactional writes** (job claim, retry/backoff updates). The atomic claim query (`BEGIN ... FOR UPDATE SKIP LOCKED ... COMMIT`) needs a real session-held transaction; Supabase's pooled connection (PgBouncer, transaction mode) is not guaranteed to behave the same way across statements.
  - **Pooled connection (port 6543)** — fine for simple, short-lived reads (dashboard stats, job list endpoints).
  - In Prisma, this means two `datasource` URLs: `DATABASE_URL` (pooled, used by default) and `DIRECT_URL` (direct, used for the worker's Prisma client and for migrations). Prisma supports this natively via the `directUrl` field in `schema.prisma`.
- **Connection limits:** free-tier Supabase caps concurrent connections. Each worker instance should use a small Prisma connection pool (e.g. append `?connection_limit=5` to its URL) so running 3+ workers for your demo doesn't exhaust the pool.
- **Auth choice:** using **Supabase Auth** instead of hand-rolled JWT saves Phase 1 time — you get register/login/session handling for free, and your Express backend just verifies the Supabase JWT on incoming requests (`supabase.auth.getUser(token)` or JWKS verification middleware). If you go this route, drop the custom `users.password_hash` column (Supabase manages its own `auth.users` table) and instead keep your own `public.users` table as a thin profile row linked by `id` to `auth.users.id`. If you'd rather keep full control and not depend on Supabase's auth APIs, hand-rolled JWT (as in the original plan) is equally fine — just pick one and don't do both.
- **Reproducibility for grading:** don't hardcode your personal Supabase project URL/keys anywhere committed. Use `.env.example` with placeholder values and document in the README that the grader can either (a) use your provided read-only demo credentials, or (b) create their own free Supabase project and run `npx prisma migrate deploy` against it in under 5 minutes. Option (b) is safer — it doesn't expose your live data.
- **Don't use Supabase-specific features** (Row Level Security policies, Realtime subscriptions, Storage) as a substitute for your own reliability logic — the reaper, atomic claiming, and retry/backoff must be your own application code, since that's what's being graded.

---

## 2. System Structure (Architecture)

### 2.1 High-level component diagram (describe this, then redraw in Excalidraw for your deliverable)

```
                        ┌─────────────────────┐
                        │      Frontend        │
                        │  (React dashboard)    │
                        │  polls every 3–5s      │
                        └──────────┬────────────┘
                                   │ HTTPS (REST)
                                   ▼
                        ┌─────────────────────┐
                        │     Backend API       │
                        │ (Express + Prisma)     │
                        │ - Auth                 │
                        │ - Projects/Queues CRUD │
                        │ - Job submission       │
                        │ - Worker registration  │
                        │ - Reaper (stale check) │
                        └──────────┬────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │     PostgreSQL         │
                        │ (single source of      │
                        │  truth + job queue)    │
                        └──────────┬────────────┘
                                   ▲
                     ┌─────────────┼─────────────┐
                     │             │             │
             ┌───────┴──────┐┌────┴────────┐┌────┴────────┐
             │   Worker #1   ││  Worker #2  ││  Worker #3   │
             │ - polls queue ││  (same code)││  (same code) │
             │ - claims job  ││             ││              │
             │ - executes    ││             ││              │
             │ - heartbeats  ││             ││              │
             └───────────────┘└─────────────┘└──────────────┘
```

**Key architectural decision to state in your docs:** Postgres *is* the
queue (no Redis/RabbitMQ/Kafka). This is a deliberate simplification —
using `FOR UPDATE SKIP LOCKED` gives you atomic claiming without an
extra moving part, which is more defensible in a time-boxed build than
a half-integrated message broker. Mention that a production system at
larger scale might offload hot queues to Redis/Kafka, but for this
scope Postgres-as-queue is the right trade-off.

### 2.2 Request flow examples (put these in your architecture doc as sequence descriptions)

**Job submission:**
```
Client → POST /queues/:id/jobs → validate (Zod) → check idempotency_key
  → insert into jobs (status=queued or scheduled) → return job
```

**Job claim + execution (worker loop):**
```
Worker → check current running count < concurrency_limit
  → run atomic claim query (SKIP LOCKED) → status becomes 'claimed'
  → mark 'running', insert job_executions row
  → execute payload handler
  → on success: mark 'completed', finish execution row
  → on failure: increment attempt_count
      → if attempts remain: compute backoff delay, status='queued', run_at = now()+delay
      → else: move to dead_letter_jobs, status='dead_letter'
```

**Heartbeat + recovery:**
```
Worker → every 10s → POST /workers/:id/heartbeat
Backend reaper → every 30s → find workers with stale last_heartbeat_at
  → mark offline → requeue their claimed/running jobs
```

### 2.3 Repository structure (from SPEC.md, repeated here for convenience)

```
job-scheduler/
├── backend/        (API server + reaper)
├── worker/         (poller, executor, heartbeat, shutdown)
├── frontend/       (dashboard)
├── docs/           (diagrams, design decisions, API docs)
└── README.md
```

Keep backend and worker in the **same repo**, sharing the same Prisma
client/types package, so you don't duplicate schema definitions or drift
between the two — a common source of bugs when time is short.

---

## 3. Implementation Plan (hour-by-hour)

This assumes ~10 focused hours. Adjust proportionally to what you actually have left, but keep the **order** — later steps depend on earlier ones being correct.

### Phase 0 — Setup (0:00–0:45)
- Init monorepo (`backend/`, `worker/`, `frontend/`), or 3 separate folders if simpler for you
- Create a new Supabase project (takes ~2 min to provision), grab both connection strings (pooled + direct) from Project Settings → Database
- Initialize Prisma in `backend/`, set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) in `.env`, paste schema from `DATABASE_SCHEMA.md` / `SPEC.md` into `schema.prisma`, run first migration with `npx prisma migrate dev` (this uses `DIRECT_URL` automatically when configured)
- Confirm `npx prisma studio` shows all 12 tables correctly connected
- Copy the same `DIRECT_URL` into `worker/.env` (with a lower `connection_limit`) so the worker talks to Postgres directly, bypassing the pooler

**Checkpoint:** DB is live on Supabase, schema matches spec exactly, both connection strings work, before any application code is written.

### Phase 1 — Backend core (0:45–3:30)
Build in this order (each depends on the last):
1. Auth (register/login/me) — keep it minimal, don't add refresh tokens or email verification
2. Projects CRUD
3. Queues CRUD + stats endpoint
4. Retry policies CRUD (needed before jobs, since jobs reference them)
5. Job submission endpoint (`POST /queues/:id/jobs`) — handle immediate/delayed/scheduled/batch; recurring can just create a `scheduled_jobs` row for now
6. Job read endpoints (list with filters/pagination, get by id with executions)
7. Worker registration + heartbeat endpoints
8. Dead letter endpoints
9. Reaper job (interval or node-cron) for stale worker recovery

**Checkpoint:** every endpoint in SPEC.md Section 9 responds correctly via Postman/curl, using real Postgres data — no worker needed yet, you can manually insert `queued` jobs to test.

### Phase 2 — Worker service (parallel with Phase 1 if using 2 tools, otherwise right after) (2:00–5:00)
1. Poller loop: for each active queue, check concurrency headroom, run atomic claim query
2. Executor: runs a simple built-in handler based on `payload.type` (e.g., a mock "sleep + succeed/fail randomly" handler is fine for demo — you're not building real business logic, you're proving the scheduler works)
3. On completion/failure: write `job_executions` row, update `jobs` status, apply retry/backoff logic
4. Heartbeat sender (every 10s)
5. Graceful shutdown handler (SIGTERM/SIGINT → stop polling → wait for in-flight → deregister)

**Checkpoint — do this yourself, don't delegate the verification:**
Run 3 worker instances (`node worker/dist/index.js` x3, or `docker compose up --scale worker=3`), submit 20 jobs, and confirm:
- Exactly 20 `job_executions` rows exist for those 20 jobs (no duplicates)
- Killing one worker mid-run causes its claimed job to be requeued and picked up by another worker within ~30–40s

This is the single most important test in the whole project.

### Phase 3 — Frontend (can start in parallel from Phase 0, using mocked API responses) (0:45–6:30)
1. Auth pages (login/register) — minimal styling
2. Layout + navigation (Projects → Queues → Jobs drill-down)
3. Queue list + create/edit queue (priority, concurrency, pause toggle)
4. Job explorer: table with status filter, pagination, click into job detail (shows executions + logs)
5. Manual retry button (calls `POST /jobs/:id/retry` or `/dead-letter/:id/requeue`)
6. Worker status page: list of workers, online/offline, last heartbeat, active job count
7. Dashboard overview: small throughput chart (Recharts) using `/dashboard/overview`
8. Wire polling (`setInterval` every 3–5s) on job explorer and worker status pages

**Checkpoint:** you can submit a job from the API, watch it move through statuses on the dashboard without refreshing, and manually retry a dead-lettered job from the UI.

### Phase 4 — Integration & hardening (6:30–8:00)
- Run the full flow end-to-end: submit batch → workers process → some fail intentionally (mock handler randomly throws) → confirm backoff delays are correct → confirm DLQ after max attempts → confirm manual requeue works
- Write 4–6 automated tests covering: atomic claim doesn't double-assign, retry backoff math, job lifecycle transitions, pagination
- Fix whatever breaks — budget real time for this, it always takes longer than expected

### Phase 5 — Documentation (do incrementally, not just at the end) (throughout + final 1:00)
- `README.md`: setup steps (create a free Supabase project → copy `.env.example` → set both connection strings → run migrations), env vars, how to run backend/worker/frontend/tests, one command to seed demo data
- `docs/design-decisions.md`: Postgres-as-queue trade-off, `job_executions` vs `jobs` split, scope cuts (cron simplification, no WebSockets, no RBAC) and why
- `docs/er-diagram.png`: exported from Prisma/dbdiagram.io
- `docs/architecture-diagram.png`: redraw the component diagram from Section 2.1 in Excalidraw
- `docs/api-docs.md`: can literally be SPEC.md Section 9, cleaned up, or a generated OpenAPI/Swagger doc if a tool can produce one quickly

### Phase 6 — Final pass (last 30–45 min)
- Clean clone into a fresh folder, follow your own README from scratch — this catches missing env vars/setup steps graders would hit immediately
- Remove dead code / console.logs / commented-out experiments
- Confirm all deliverables from the assignment checklist are present

---

## 4. Parallelization Plan Across Your 3 AI Tools

Since you have Gemini CLI, Codex, and Antigravity but not Claude Code, run them **concurrently**, not one after another:

| Tool assignment | Feeds from SPEC.md | Deliverable |
|---|---|---|
| Tool A → Backend (Phase 1) | Sections 3, 5, 6, 7, 9, 11 | API + Prisma schema + reaper |
| Tool B → Worker (Phase 2) | Sections 3, 5, 6, 7 | Poller/executor/heartbeat/shutdown |
| Tool C → Frontend (Phase 3) | Section 9 (API contract) only, with mocked responses initially | Dashboard UI |

Sync point: once Tool A's API is live, point Tool C's frontend at the real backend and remove mocks. Point Tool B's worker at the real DB from the start (Phase 0 checkpoint) since it doesn't depend on the API layer at all — it talks to Postgres directly.

---

## 5. Definition of Done (use as your final checklist)

- [ ] All 5 job types can be submitted and processed (recurring can be simplified)
- [ ] 3 workers can run concurrently with zero duplicate executions (tested, not assumed)
- [ ] Retry backoff (all 3 strategies) computed correctly and verified with logs/timestamps
- [ ] Dead letter queue populated after max attempts, manual requeue works from UI
- [ ] Worker crash → stale detection → job requeued automatically
- [ ] Dashboard shows live-ish (polled) queue/job/worker state
- [ ] README lets a stranger run the whole thing from a clean clone
- [ ] ER diagram + architecture diagram + design-decisions doc all present in `docs/`
- [ ] At least a handful of automated tests pass, especially around atomic claiming

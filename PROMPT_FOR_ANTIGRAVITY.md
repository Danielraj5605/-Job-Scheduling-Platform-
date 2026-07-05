# Master Prompt for Antigravity

## How to use this

1. Attach/paste these three files into Antigravity's context first (in order): `SPEC.md`, `DATABASE_SCHEMA.md`, `IMPLEMENTATION_PLAN.md`.
2. Paste the prompt below as your instruction.
3. Antigravity is told to work **phase by phase and stop for your review** after each one — don't let it run unattended through all phases in one shot. Review its output at each STOP, then reply "continue to Phase X" to move forward.
4. When it reaches the Phase 2 checkpoint (multi-worker test), **you** run that test yourself per the instructions — don't have Antigravity self-report the result.

---

## The Prompt

```
You are building a production-inspired distributed job scheduler. I have
attached three documents that are the single source of truth for this
project: SPEC.md (schema, API contract, atomic claim query, retry math),
DATABASE_SCHEMA.md (schema rationale), and IMPLEMENTATION_PLAN.md (tech
stack, architecture, phased build order).

Follow these documents exactly. Do not invent your own schema, table
names, column names, API paths, request/response shapes, or the atomic
claim query — match them precisely. If something in my request seems to
conflict with these documents, point it out instead of silently picking
one interpretation.

GLOBAL CONSTRAINTS (apply to every phase):
- Tech stack is fixed: Node.js + TypeScript + Express, Prisma, Supabase
  (PostgreSQL), React + Vite + TypeScript + Tailwind, Recharts, Zod,
  Vitest. Do not introduce a different framework, ORM, or database
  without asking me first.
- The job claim query MUST use `FOR UPDATE SKIP LOCKED` exactly as
  written in SPEC.md Section 5. Never replace it with an
  application-level mutex, a `SELECT` followed by a separate `UPDATE`,
  or any pattern that isn't a single atomic transaction.
- Use the DIRECT (non-pooled) Supabase connection string for the
  worker's Prisma client and for any transactional write in the backend
  (job claiming, retry updates). Use the pooled connection string only
  for simple reads.
- Match REST paths and JSON shapes in SPEC.md Section 9 exactly — do not
  rename fields, change nesting, or add undocumented fields without
  telling me.
- Do not add new npm dependencies without flagging them to me first and
  explaining why.
- After every phase, output a short summary of what was built/changed
  and a list of file paths touched — do not silently modify files
  outside the current phase's scope.
- Write code, not just descriptions — I need runnable output, not a plan
  restated in prose.

WORK IN THIS ORDER, STOPPING AFTER EACH PHASE FOR MY REVIEW:

PHASE 0 — Setup
- Scaffold the monorepo structure from IMPLEMENTATION_PLAN.md Section
  2.3 (backend/, worker/, frontend/, docs/).
- Set up Prisma in backend/ with schema.prisma matching SPEC.md Section
  3 exactly, including the `directUrl` field for Supabase (see
  IMPLEMENTATION_PLAN.md Section 1.1).
- Give me the exact steps I need to run manually (creating the Supabase
  project, where to paste connection strings) since you cannot do that
  part for me.
- Generate .env.example files for backend/ and worker/ with every
  variable needed.
STOP. I will run the migration myself and confirm the schema looks
correct in Supabase before you continue.

PHASE 1 — Backend core
Build, in this order: auth (Supabase Auth integration OR JWT — ask me
which before starting), projects CRUD, queues CRUD + stats endpoint,
retry policies CRUD, job submission endpoint (all 5 types), job read
endpoints (list w/ pagination+filters, get by id w/ executions), worker
registration + heartbeat endpoints, dead letter endpoints, and the
reaper (stale worker recovery, per SPEC.md Section 7).
Match every endpoint to SPEC.md Section 9.
STOP. I will test these endpoints manually before you continue.

PHASE 2 — Worker service
Build the poller (atomic claim per SPEC.md Section 5, respecting queue
concurrency_limit), a mock executor (make failure mode configurable —
e.g. payload.shouldFail flag — per our failure-mechanism decision),
retry/backoff logic (SPEC.md Section 6), heartbeat sender, and graceful
shutdown (SPEC.md Section 8).
STOP. I will personally run a 3-worker concurrency test (submit 20
jobs, confirm exactly 20 job_executions with no duplicates, kill one
worker mid-run and confirm its job gets requeued) before you continue.
Do not tell me this test passed — I am running it myself.

PHASE 3 — Frontend
Build the dashboard: auth pages, project/queue navigation, job explorer
with status filters + pagination + detail view (executions + logs),
manual retry button, worker status page, and a throughput chart. Use
polling (3–5s interval) for live-ish updates, not WebSockets. Start
against mocked API responses if the backend isn't finished yet, matching
SPEC.md Section 9's shapes exactly so swapping to the real API later is
a one-line change.
STOP. I will review the UI and wire it to the real backend before you
continue.

PHASE 4 — Integration & tests
Run the full flow end to end conceptually and tell me what you'd expect
to happen at each step. Write automated tests (Vitest) covering: atomic
claim doesn't double-assign under concurrent calls, retry backoff math
for all 3 strategies, job lifecycle status transitions, and pagination.
STOP. I will run the test suite myself and report back any failures.

PHASE 5 — Documentation
Generate: README.md (setup incl. Supabase project creation, env vars,
run commands, seed script usage), docs/design-decisions.md (draft only
— I will fill in my own reasoning, but scaffold the sections: DB choice,
Postgres-as-queue trade-off, auth choice, scope cuts), docs/api-docs.md
(from SPEC.md Section 9). Also generate a Prisma seed script per
FINAL_CHECKLIST.md Section 1 (one project, 2-3 queues with different
retry policies, a batch of jobs with some designed to fail).
STOP. I will review all docs and do my own clean-clone test before
submission.

Begin with Phase 0 now. Ask me any clarifying questions before you
start if something in the attached documents is ambiguous — do not
guess on schema or API details.
```

---

## Notes on using this effectively

- **Don't skip the STOPs**, even if Antigravity seems confident. The whole point of phase gating is catching drift early — a wrong assumption in Phase 0 (e.g., a slightly different column name) will silently break everything downstream if it's not caught until Phase 3.
- **The Phase 2 STOP is non-negotiable.** Antigravity cannot verify the concurrency behavior for you in a way you should trust blindly — run the 3-worker test with your own hands before calling that phase done.
- If Antigravity's context window can't hold all three attached docs plus a long conversation, paste only the **relevant section** for the current phase (e.g., just Sections 3 and 5 for Phase 0/2) rather than the whole bundle every time.
- If you're also running Gemini CLI or Codex in parallel for the worker or frontend (per IMPLEMENTATION_PLAN.md Section 4), give them the equivalent phase block (Phase 2 or Phase 3) with the same global constraints, rather than the whole prompt — that keeps them focused and avoids overlapping work.

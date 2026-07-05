/**
 * Typed API client — matches SPEC.md Section 9 exactly.
 * All paths, field names, and response shapes are from the spec.
 * Swapping from mock to real API is a one-line VITE_API_BASE_URL change.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}

export interface RetryPolicy {
  id: string;
  name: string;
  strategy: 'fixed' | 'linear' | 'exponential';
  base_delay_seconds: number;
  max_delay_seconds: number;
  max_attempts: number;
}

export interface Queue {
  id: string;
  projectId: string;
  name: string;
  priority: number;
  concurrencyLimit: number;
  isPaused: boolean;
  defaultRetryPolicyId: string | null;
  createdAt: string;
  defaultRetryPolicy?: RetryPolicy | null;
}

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  dead_letter: number;
  throughput_per_min: number;
}

export interface Job {
  id: string;
  queueId: string;
  type: 'immediate' | 'delayed' | 'scheduled' | 'recurring' | 'batch';
  payload: Record<string, unknown>;
  status: 'queued' | 'scheduled' | 'claimed' | 'running' | 'completed' | 'failed' | 'dead_letter';
  priority: number;
  runAt: string | null;
  cronExpression: string | null;
  batchId: string | null;
  idempotencyKey: string | null;
  retryPolicyId: string | null;
  attemptCount: number;
  maxAttempts: number;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  executions?: JobExecution[];
}

export interface JobExecution {
  id: string;
  jobId: string;
  workerId: string | null;
  attemptNumber: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  errorStack: string | null;
  logs?: JobLog[];
}

export interface JobLog {
  id: string;
  jobExecutionId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export interface Worker {
  id: string;
  hostname: string;
  status: 'online' | 'offline' | 'draining';
  concurrency: number;
  startedAt: string;
  lastHeartbeatAt: string;
  heartbeats?: WorkerHeartbeat[];
}

export interface WorkerHeartbeat {
  id: string;
  workerId: string;
  activeJobCount: number;
  recordedAt: string;
}

export interface DeadLetterJob {
  id: string;
  originalJobId: string;
  queueId: string;
  payload: Record<string, unknown>;
  finalError: string | null;
  attemptCount: number;
  movedAt: string;
}


export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  total: number;
}

export interface DashboardOverview {
  total_queues: number;
  total_workers_online: number;
  jobs_last_24h: { completed: number; failed: number };
  throughput_series: Array<{ timestamp: string; completed_count: number }>;
}

// ─── API Request helper ───────────────────────────────────────────────────────

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'NETWORK_ERROR', message: res.statusText } }));
    throw Object.assign(new Error(body?.error?.message ?? 'Request failed'), { status: res.status, code: body?.error?.code });
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (data: { email: string; password: string; name?: string }) =>
    request<{ user: User; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<{ user: User }>('/auth/me'),
};

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: (page = 1, limit = 20) =>
    request<PaginatedResponse<Project>>(`/projects?page=${page}&limit=${limit}`),
  create: (data: { name: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => request<Project>(`/projects/${id}`),
  delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

// ─── Queues ──────────────────────────────────────────────────────────────────

export const queuesApi = {
  listByProject: (projectId: string) =>
    request<Queue[]>(`/projects/${projectId}/queues`),
  create: (projectId: string, data: { name: string; priority?: number; concurrency_limit?: number; retry_policy_id?: string }) =>
    request<Queue>(`/projects/${projectId}/queues`, { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => request<Queue>(`/queues/${id}`),
  update: (id: string, data: { priority?: number; concurrency_limit?: number; is_paused?: boolean }) =>
    request<Queue>(`/queues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/queues/${id}`, { method: 'DELETE' }),
  stats: (id: string) => request<QueueStats>(`/queues/${id}/stats`),
};

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const jobsApi = {
  submit: (queueId: string, data: {
    type: Job['type'];
    payload: Record<string, unknown>;
    run_at?: string;
    cron_expression?: string;
    jobs?: Array<{ payload: Record<string, unknown>; run_at?: string }>;
    idempotency_key?: string;
    retry_policy_id?: string;
    priority?: number;
  }) => request<Job | Job[]>(`/queues/${queueId}/jobs`, { method: 'POST', body: JSON.stringify(data) }),
  list: (queueId: string, params: { status?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<PaginatedResponse<Job>>(`/queues/${queueId}/jobs?${qs}`);
  },
  get: (id: string) => request<Job>(`/jobs/${id}`),
  retry: (id: string) => request<Job>(`/jobs/${id}/retry`, { method: 'POST' }),
  delete: (id: string) => request<void>(`/jobs/${id}`, { method: 'DELETE' }),
  executions: (jobId: string) => request<JobExecution[]>(`/jobs/${jobId}/executions`),
  logs: (executionId: string) => request<JobLog[]>(`/executions/${executionId}/logs`),
};

// ─── Workers ─────────────────────────────────────────────────────────────────

export const workersApi = {
  list: (status?: string) => request<Worker[]>(`/workers${status ? `?status=${status}` : ''}`),
  get: (id: string) => request<Worker>(`/workers/${id}`),
};

// ─── Dead Letter ──────────────────────────────────────────────────────────────

export const deadLetterApi = {
  list: (queueId: string) => request<DeadLetterJob[]>(`/queues/${queueId}/dead-letter`),
  requeue: (id: string) => request<Job>(`/dead-letter/${id}/requeue`, { method: 'POST' }),
};

// ─── Retry Policies ───────────────────────────────────────────────────────────

export const retryPoliciesApi = {
  list: () => request<RetryPolicy[]>('/retry-policies'),
  create: (data: { name: string; strategy: RetryPolicy['strategy']; base_delay_seconds: number; max_delay_seconds: number; max_attempts: number }) =>
    request<RetryPolicy>('/retry-policies', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const dashboardApi = {
  overview: () => request<DashboardOverview>('/dashboard/overview'),
};

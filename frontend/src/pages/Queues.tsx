import React, { useState } from 'react';
// Note: API returns snake_case field names per SPEC.md Section 9
import { useParams, useNavigate } from 'react-router-dom';
import { useFetch, usePolling } from '../hooks/usePolling';
import { queuesApi, jobsApi, deadLetterApi, retryPoliciesApi, type Queue, type Job, type QueueStats, type DeadLetterJob, type RetryPolicy } from '../api/client';
import StatusBadge from '../components/StatusBadge';

const JOB_STATUSES = ['queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter'];

export default function Queues() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null);
  const [showCreateQueue, setShowCreateQueue] = useState(false);
  const [showSubmitJob, setShowSubmitJob] = useState(false);

  const { data: queues, isLoading, refetch: refetchQueues } = useFetch<Queue[]>(
    () => queuesApi.listByProject(projectId!)
  );

  const { data: policies } = useFetch<RetryPolicy[]>(() => retryPoliciesApi.list());

  return (
    <div style={{ padding: '2rem' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <button
            onClick={() => navigate('/projects')}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem', padding: '0 0 0.5rem', display: 'block' }}
          >
            ← Back to Projects
          </button>
          <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Queues</h1>
        </div>
        <button id="create-queue-btn" className="btn btn-primary" onClick={() => setShowCreateQueue(true)}>
          + New Queue
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedQueue ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
          {/* Queue list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {queues?.map((q) => (
              <QueueCard
                key={q.id}
                queue={q}
                isSelected={selectedQueue?.id === q.id}
                onClick={() => setSelectedQueue(q.id === selectedQueue?.id ? null : q)}
                onPauseToggle={async () => {
                  await queuesApi.update(q.id, { is_paused: !q.isPaused });
                  refetchQueues();
                }}
                onDelete={async () => {
                  if (window.confirm(`Delete queue "${q.name}"?`)) {
                    await queuesApi.delete(q.id);
                    setSelectedQueue(null);
                    refetchQueues();
                  }
                }}
              />
            ))}
            {queues?.length === 0 && (
              <div className="empty-state card">
                <div className="empty-icon">📋</div>
                <p style={{ fontWeight: 600 }}>No queues yet</p>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowCreateQueue(true)}>
                  Create Queue
                </button>
              </div>
            )}
          </div>

          {/* Queue detail panel */}
          {selectedQueue && (
            <QueueDetail
              queue={selectedQueue}
              onSubmitJob={() => setShowSubmitJob(true)}
            />
          )}
        </div>
      )}

      {/* Create Queue Modal */}
      {showCreateQueue && (
        <CreateQueueModal
          projectId={projectId!}
          policies={policies ?? []}
          onClose={() => setShowCreateQueue(false)}
          onCreated={() => { setShowCreateQueue(false); refetchQueues(); }}
        />
      )}

      {/* Submit Job Modal */}
      {showSubmitJob && selectedQueue && (
        <SubmitJobModal
          queue={selectedQueue}
          policies={policies ?? []}
          onClose={() => setShowSubmitJob(false)}
          onSubmitted={() => setShowSubmitJob(false)}
        />
      )}
    </div>
  );
}

function QueueCard({ queue, isSelected, onClick, onPauseToggle, onDelete }: {
  queue: Queue; isSelected: boolean; onClick: () => void;
  onPauseToggle: () => void; onDelete: () => void;
}) {
  const { data: stats } = usePolling<QueueStats>(() => queuesApi.stats(queue.id), 5000);

  return (
    <div
      className="card"
      style={{
        cursor: 'pointer',
        borderColor: isSelected ? 'var(--accent-primary)' : undefined,
        background: isSelected ? 'var(--bg-card-hover)' : undefined,
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{queue.name}</h3>
            {queue.isPaused && <StatusBadge status="draining" size="sm" />}
          </div>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            <span>Priority: {queue.priority}</span>
            <span>Concurrency: {queue.concurrencyLimit}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onPauseToggle}
          >
            {queue.isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.875rem', fontSize: '0.8rem' }}>
          {[
            { label: 'Queued', value: stats.queued, color: '#60a5fa' },
            { label: 'Running', value: stats.running, color: '#22d3ee' },
            { label: 'Completed', value: stats.completed, color: '#4ade80' },
            { label: 'Failed', value: stats.failed, color: '#f87171' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color, fontSize: '1.1rem' }}>{value}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{label}</div>
            </div>
          ))}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, color: '#a78bfa', fontSize: '1.1rem' }}>{stats.throughput_per_min}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>/min</div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueDetail({ queue, onSubmitJob }: { queue: Queue; onSubmitJob: () => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { data: jobsData, refetch } = usePolling(
    () => jobsApi.list(queue.id, { status: statusFilter || undefined, page, limit: 10 }),
    4000
  );

  const { data: dlJobs } = usePolling(
    () => deadLetterApi.list(queue.id),
    5000
  );

  const handleRetry = async (jobId: string) => {
    try {
      await jobsApi.retry(jobId);
      refetch();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRequeue = async (dlJobId: string) => {
    try {
      await deadLetterApi.requeue(dlJobId);
      refetch();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Jobs — {queue.name}</h3>
          <button id="submit-job-btn" className="btn btn-primary btn-sm" onClick={onSubmitJob}>
            + Submit Job
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${!statusFilter ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setStatusFilter(''); setPage(1); }}
          >All</button>
          {JOB_STATUSES.map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setStatusFilter(s); setPage(1); }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Jobs table */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Attempts</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobsData?.data.map((job) => (
                <tr key={job.id} onClick={() => setSelectedJob(job)}>
                  <td><span className="mono">{job.type}</span></td>
                  <td><StatusBadge status={job.status} /></td>
                  <td>{job.priority}</td>
                  <td>{job.attemptCount}/{job.maxAttempts}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {['failed', 'dead_letter'].includes(job.status) && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRetry(job.id)}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {jobsData?.data.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No jobs</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {jobsData && jobsData.total > 10 && (
          <div className="pagination">
            <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Page {page} of {Math.ceil(jobsData.total / 10)}
            </span>
            <button className="page-btn" disabled={page >= Math.ceil(jobsData.total / 10)} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>

      {/* Dead Letter section */}
      {dlJobs && dlJobs.length > 0 && (
        <div className="card" style={{ borderColor: 'rgba(107,114,128,0.3)' }}>
          <h3 style={{ margin: '0 0 1rem', color: '#9ca3af' }}>☠ Dead Letter Queue ({dlJobs.length})</h3>
          <div className="table-container">
            <table>
              <thead><tr><th>ID</th><th>Attempts</th><th>Final Error</th><th>Moved At</th><th>Action</th></tr></thead>
              <tbody>
                {dlJobs.map((dlJob: DeadLetterJob) => (
                  <tr key={dlJob.id}>
                    <td className="mono" style={{ fontSize: '0.75rem' }}>{dlJob.originalJobId.slice(0, 8)}…</td>
                    <td>{dlJob.attemptCount}</td>
                    <td style={{ color: 'var(--error)', fontSize: '0.8rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dlJob.finalError ?? '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(dlJob.movedAt).toLocaleString()}
                    </td>
                    <td>
                      <button
                        id={`requeue-${dlJob.id}`}
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRequeue(dlJob.id)}
                      >
                        Requeue
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Job detail modal */}
      {selectedJob && (
        <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} onRetry={() => { handleRetry(selectedJob.id); setSelectedJob(null); }} />
      )}
    </div>
  );
}

function JobDetailModal({ job, onClose, onRetry }: { job: Job; onClose: () => void; onRetry: () => void }) {
  const { data: fullJob } = useFetch(() => jobsApi.get(job.id));

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '700px' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Job Details</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <StatusBadge status={job.status} />
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{job.id}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {[
            ['Type', job.type],
            ['Priority', String(job.priority)],
            ['Attempts', `${job.attemptCount} / ${job.maxAttempts}`],
            ['Created', new Date(job.createdAt).toLocaleString()],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{k}</div>
              <div style={{ fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Payload */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Payload</div>
          <pre style={{ background: 'var(--bg-elevated)', padding: '0.875rem', borderRadius: '8px', fontSize: '0.8125rem', overflowX: 'auto', margin: 0 }}>
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>

        {/* Executions */}
        {fullJob?.executions && fullJob.executions.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="section-title">Execution History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {fullJob.executions.map((exec) => (
                <div key={exec.id} style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600 }}>Attempt #{exec.attemptNumber}</div>
                    <StatusBadge status={exec.status} size="sm" />
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {exec.durationMs != null && <span>Duration: {exec.durationMs}ms · </span>}
                    {new Date(exec.startedAt).toLocaleString()}
                  </div>
                  {exec.errorMessage && (
                    <div style={{ color: 'var(--error)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                      {exec.errorMessage}
                    </div>
                  )}
                  {exec.logs && exec.logs.length > 0 && (
                    <div style={{ marginTop: '0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', padding: '0.625rem', maxHeight: '150px', overflowY: 'auto' }}>
                      {exec.logs.map((log) => (
                        <div key={log.id} className={`log-line ${log.level}`}>
                          <span style={{ opacity: 0.5, flexShrink: 0 }}>{new Date(log.createdAt).toLocaleTimeString()}</span>
                          <span>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {['failed', 'dead_letter'].includes(job.status) && (
          <button id="retry-job-btn" className="btn btn-primary" onClick={onRetry} style={{ width: '100%', justifyContent: 'center' }}>
            ↺ Retry Job
          </button>
        )}
      </div>
    </div>
  );
}

function CreateQueueModal({ projectId, policies, onClose, onCreated }: {
  projectId: string; policies: RetryPolicy[];
  onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(0);
  const [concurrency, setConcurrency] = useState(5);
  const [retryPolicyId, setRetryPolicyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await queuesApi.create(projectId, {
        name,
        priority,
        concurrency_limit: concurrency,
        retry_policy_id: retryPolicyId || undefined,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>New Queue</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
        </div>
        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="queue-name">Queue Name</label>
            <input id="queue-name" type="text" className="input" placeholder="e.g. send-email" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="queue-priority">Priority</label>
              <input id="queue-priority" type="number" className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label htmlFor="queue-concurrency">Concurrency Limit</label>
              <input id="queue-concurrency" type="number" min={1} className="input" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="queue-retry-policy">Default Retry Policy</label>
            <select id="queue-retry-policy" className="input" value={retryPolicyId} onChange={(e) => setRetryPolicyId(e.target.value)}>
              <option value="">None</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.strategy}, {p.max_attempts} max)</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Queue'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SubmitJobModal({ queue, policies, onClose, onSubmitted }: {
  queue: Queue; policies: RetryPolicy[];
  onClose: () => void; onSubmitted: () => void;
}) {
  const [type, setType] = useState<Job['type']>('immediate');
  const [payloadStr, setPayloadStr] = useState('{\n  "message": "Hello World"\n}');
  const [runAt, setRunAt] = useState('');
  const [cron, setCron] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [retryPolicyId, setRetryPolicyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(payloadStr); } catch { setError('Payload must be valid JSON'); return; }
    setLoading(true);
    try {
      await jobsApi.submit(queue.id, {
        type,
        payload,
        run_at: runAt || undefined,
        cron_expression: cron || undefined,
        idempotency_key: idempotencyKey || undefined,
        retry_policy_id: retryPolicyId || undefined,
      });
      onSubmitted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Submit Job to {queue.name}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
        </div>
        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="job-type">Job Type</label>
            <select id="job-type" className="input" value={type} onChange={(e) => setType(e.target.value as Job['type'])}>
              {['immediate', 'delayed', 'scheduled', 'recurring'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {(type === 'delayed' || type === 'scheduled') && (
            <div className="form-group">
              <label htmlFor="job-run-at">Run At (ISO date)</label>
              <input id="job-run-at" type="datetime-local" className="input" value={runAt} onChange={(e) => setRunAt(e.target.value ? new Date(e.target.value).toISOString() : '')} />
            </div>
          )}
          {type === 'recurring' && (
            <div className="form-group">
              <label htmlFor="job-cron">Cron Expression</label>
              <input id="job-cron" type="text" className="input" placeholder="* * * * *" value={cron} onChange={(e) => setCron(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="job-payload">Payload (JSON)</label>
            <textarea id="job-payload" className="input mono" rows={5} value={payloadStr} onChange={(e) => setPayloadStr(e.target.value)} style={{ resize: 'vertical', fontFamily: 'monospace' }} />
          </div>
          <div className="form-group">
            <label htmlFor="job-idempotency-key">Idempotency Key (optional)</label>
            <input id="job-idempotency-key" type="text" className="input" value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="job-retry-policy">Retry Policy (optional)</label>
            <select id="job-retry-policy" className="input" value={retryPolicyId} onChange={(e) => setRetryPolicyId(e.target.value)}>
              <option value="">Queue default</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Submitting...' : 'Submit Job'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

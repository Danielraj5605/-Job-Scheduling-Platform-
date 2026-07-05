import { useState } from 'react';
import { useFetch, usePolling } from '../hooks/usePolling';
import { jobsApi, queuesApi, projectsApi, type Job, type Queue, type Project } from '../api/client';
import StatusBadge from '../components/StatusBadge';

const STATUSES = ['queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter'];

export default function JobExplorer() {
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedQueueId, setSelectedQueueId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { data: projectsData } = useFetch(() => projectsApi.list());
  const { data: queues } = useFetch<Queue[]>(async () => {
    const allQueues: Queue[] = [];
    for (const p of projectsData?.data ?? []) {
      const qs = await queuesApi.listByProject(p.id);
      allQueues.push(...qs);
    }
    return allQueues;
  });

  // Poll jobs in the selected queue (or all if none selected)
  const { data: jobsData, refetch } = usePolling(
    () => {
      if (!selectedQueueId && (!queues || queues.length === 0)) return Promise.resolve({ data: [], page: 1, total: 0 });
      const queueId = selectedQueueId || (queues?.[0]?.id ?? '');
      if (!queueId) return Promise.resolve({ data: [], page: 1, total: 0 });
      return jobsApi.list(queueId, { status: statusFilter || undefined, page, limit: 15 });
    },
    4000
  );

  const handleRetry = async (jobId: string) => {
    try {
      await jobsApi.retry(jobId);
      refetch();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div style={{ padding: '2rem' }} className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Job Explorer</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
          Browse, filter, and manage jobs — updates every 4 seconds
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          id="queue-filter"
          className="input"
          style={{ maxWidth: '200px' }}
          value={selectedQueueId}
          onChange={(e) => { setSelectedQueueId(e.target.value); setPage(1); }}
        >
          <option value="">All Queues</option>
          {queues?.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${!statusFilter ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setStatusFilter(''); setPage(1); }}
          >All</button>
          {STATUSES.map((s) => (
            <button
              key={s}
              id={`filter-${s}`}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setStatusFilter(s); setPage(1); }}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
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
                  <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {job.id.slice(0, 8)}…
                  </td>
                  <td><span className="mono">{job.type}</span></td>
                  <td><StatusBadge status={job.status} /></td>
                  <td>{job.priority}</td>
                  <td>{job.attemptCount}/{job.maxAttempts}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {['failed', 'dead_letter'].includes(job.status) && (
                      <button
                        id={`retry-${job.id}`}
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRetry(job.id)}
                      >↺ Retry</button>
                    )}
                  </td>
                </tr>
              ))}
              {jobsData?.data.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No jobs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {jobsData && jobsData.total > 15 && (
          <div className="pagination" style={{ padding: '1rem' }}>
            <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {page} / {Math.ceil(jobsData.total / 15)} · {jobsData.total} jobs
            </span>
            <button className="page-btn" disabled={page >= Math.ceil(jobsData.total / 15)} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>

      {/* Job detail modal */}
      {selectedJob && (
        <JobDetailModal
          jobId={selectedJob.id}
          initialJob={selectedJob}
          onClose={() => setSelectedJob(null)}
          onRetry={() => { handleRetry(selectedJob.id); setSelectedJob(null); }}
        />
      )}
    </div>
  );
}

function JobDetailModal({ jobId, initialJob, onClose, onRetry }: {
  jobId: string; initialJob: Job; onClose: () => void; onRetry: () => void;
}) {
  const { data: job } = useFetch(() => jobsApi.get(jobId));
  const displayJob = job ?? initialJob;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '700px' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Job Details</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <StatusBadge status={displayJob.status} />
              <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{displayJob.id}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {[
            ['Type', displayJob.type],
            ['Priority', String(displayJob.priority)],
            ['Attempts', `${displayJob.attemptCount} / ${displayJob.maxAttempts}`],
            ['Created', new Date(displayJob.createdAt).toLocaleString()],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{k}</div>
              <div style={{ fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-title">Payload</div>
          <pre style={{ background: 'var(--bg-elevated)', padding: '0.875rem', borderRadius: '8px', fontSize: '0.8125rem', overflowX: 'auto', margin: 0 }}>
            {JSON.stringify(displayJob.payload, null, 2)}
          </pre>
        </div>

        {job?.executions && job.executions.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="section-title">Executions ({job.executions.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
              {job.executions.map((exec) => (
                <div key={exec.id} style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <span style={{ fontWeight: 600 }}>Attempt #{exec.attemptNumber}</span>
                    <StatusBadge status={exec.status} size="sm" />
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {exec.durationMs != null && `${exec.durationMs}ms · `}
                    {new Date(exec.startedAt).toLocaleString()}
                  </div>
                  {exec.errorMessage && (
                    <div style={{ color: 'var(--error)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                      ✕ {exec.errorMessage}
                    </div>
                  )}
                  {exec.logs && exec.logs.length > 0 && (
                    <div style={{ marginTop: '0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', padding: '0.625rem', maxHeight: '120px', overflowY: 'auto' }}>
                      {exec.logs.map((log) => (
                        <div key={log.id} className={`log-line ${log.level}`}>
                          <span style={{ opacity: 0.4, flexShrink: 0 }}>{new Date(log.createdAt).toLocaleTimeString()}</span>
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

        {['failed', 'dead_letter'].includes(displayJob.status) && (
          <button className="btn btn-primary" onClick={onRetry} style={{ width: '100%', justifyContent: 'center' }}>
            ↺ Retry Job
          </button>
        )}
      </div>
    </div>
  );
}

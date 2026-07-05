import { usePolling, useFetch } from '../hooks/usePolling';
import { workersApi, type Worker, type WorkerHeartbeat } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function WorkerStatus() {
  const { data: workers, isLoading, error } = usePolling<Worker[]>(
    () => workersApi.list(),
    5000
  );

  const online = workers?.filter((w) => w.status === 'online').length ?? 0;
  const offline = workers?.filter((w) => w.status !== 'online').length ?? 0;

  return (
    <div style={{ padding: '2rem' }} className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Worker Status</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
          Live worker health — refreshes every 5 seconds
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{online}</div>
          <div className="stat-label">Online Workers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>{offline}</div>
          <div className="stat-label">Offline Workers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{workers?.length ?? 0}</div>
          <div className="stat-label">Total Registered</div>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : workers?.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-icon">🔧</div>
          <p style={{ fontWeight: 600 }}>No workers registered</p>
          <p style={{ fontSize: '0.875rem' }}>Start a worker process with <code style={{ background: 'var(--bg-elevated)', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>npm run dev</code> in the worker/ directory.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {workers?.map((worker) => (
            <WorkerCard key={worker.id} worker={worker} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ worker }: { worker: Worker }) {
  const { data: detail } = useFetch(() => workersApi.get(worker.id));

  const isStale = Date.now() - new Date(worker.lastHeartbeatAt).getTime() > 30_000;
  const lastSeen = Math.floor((Date.now() - new Date(worker.lastHeartbeatAt).getTime()) / 1000);

  const heartbeatChartData = (detail?.heartbeats ?? [])
    .slice(0, 20)
    .reverse()
    .map((hb: WorkerHeartbeat, i: number) => ({
      t: i,
      active: hb.activeJobCount,
    }));

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontFamily: 'monospace' }}>{worker.hostname}</h3>
            <StatusBadge status={worker.status} />
            {isStale && worker.status === 'online' && (
              <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>Stale</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            <span>Concurrency: {worker.concurrency}</span>
            <span>Started: {new Date(worker.startedAt).toLocaleString()}</span>
            <span>Last heartbeat: {lastSeen < 60 ? `${lastSeen}s ago` : `${Math.floor(lastSeen / 60)}m ago`}</span>
          </div>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {worker.id.slice(0, 8)}…
        </div>
      </div>

      {heartbeatChartData.length > 1 && (
        <div style={{ height: '80px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={heartbeatChartData}>
              <defs>
                <linearGradient id={`hbGrad-${worker.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6c63ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6c63ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="t" hide />
              <YAxis hide allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.75rem' }}
                formatter={(v: number) => [v, 'Active jobs']}
                labelFormatter={() => ''}
              />
              <Area
                type="monotone"
                dataKey="active"
                stroke="#6c63ff"
                strokeWidth={1.5}
                fill={`url(#hbGrad-${worker.id})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

import { usePolling } from '../hooks/usePolling';
import { dashboardApi, type DashboardOverview } from '../api/client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const { data, error, isLoading } = usePolling<DashboardOverview>(
    () => dashboardApi.overview(),
    5000
  );

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', display: 'flex', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem' }}>
        <div className="alert alert-error">Failed to load dashboard: {error}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem' }} className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
          Live overview — refreshes every 5 seconds
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-value">{data?.total_queues ?? 0}</div>
          <div className="stat-label">Total Queues</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{data?.total_workers_online ?? 0}</div>
          <div className="stat-label">Workers Online</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#4ade80' }}>{data?.jobs_last_24h.completed ?? 0}</div>
          <div className="stat-label">Jobs Completed (24h)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--error)' }}>{data?.jobs_last_24h.failed ?? 0}</div>
          <div className="stat-label">Jobs Failed (24h)</div>
        </div>
      </div>

      {/* Throughput chart */}
      <div className="card">
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Throughput — Completed Jobs per Hour</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>Last 24 hours</p>
        </div>

        {data?.throughput_series && data.throughput_series.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.throughput_series}>
              <defs>
                <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6c63ff" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6c63ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                tick={{ fill: '#8888a8', fontSize: 12 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8888a8', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                }}
                labelFormatter={formatTime}
                formatter={(v: any) => [v, 'Completed']}
              />
              <Area
                type="monotone"
                dataKey="completed_count"
                stroke="#6c63ff"
                strokeWidth={2}
                fill="url(#throughputGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#6c63ff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📈</div>
            <p>No job completions in the last 24 hours yet.</p>
            <p style={{ fontSize: '0.8125rem' }}>Submit and run some jobs to see throughput data here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

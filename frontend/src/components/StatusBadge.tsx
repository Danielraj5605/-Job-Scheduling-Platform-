import type { Job } from '../api/client';

interface Props {
  status: Job['status'] | 'online' | 'offline' | 'draining' | string;
  size?: 'sm' | 'md';
}

const LABELS: Record<string, string> = {
  queued: 'Queued',
  scheduled: 'Scheduled',
  claimed: 'Claimed',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  dead_letter: 'Dead Letter',
  online: 'Online',
  offline: 'Offline',
  draining: 'Draining',
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  return (
    <span
      className={`badge badge-${status}`}
      style={size === 'sm' ? { fontSize: '0.6875rem', padding: '0.125rem 0.5rem' } : undefined}
    >
      {LABELS[status] ?? status}
    </span>
  );
}

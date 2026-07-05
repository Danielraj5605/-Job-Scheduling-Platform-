import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.875rem',
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: isActive ? 'white' : 'var(--text-secondary)',
    background: isActive ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
    transition: 'all 0.15s ease',
  });

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: '220px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 0.75rem',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '0.5rem', marginBottom: '2rem' }}>
          <div style={{
            width: '32px', height: '32px',
            background: 'linear-gradient(135deg, #6c63ff, #8b5cf6)',
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', flexShrink: 0,
          }}>⚡</div>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>JobScheduler</span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0.5rem', marginBottom: '0.5rem' }}>Overview</div>
          <NavLink to="/" end style={navStyle}>📊 Dashboard</NavLink>
          
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0.5rem', marginTop: '1rem', marginBottom: '0.5rem' }}>Manage</div>
          <NavLink to="/projects" style={navStyle}>📁 Projects</NavLink>
          <NavLink to="/jobs" style={navStyle}>📋 Job Explorer</NavLink>
          <NavLink to="/workers" style={navStyle}>🔧 Workers</NavLink>
        </nav>

        {/* User */}
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: '1rem',
          marginTop: '1rem',
        }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', paddingLeft: '0.5rem', marginBottom: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button
            onClick={handleSignOut}
            style={{
              width: '100%',
              padding: '0.5rem 0.875rem',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--error)')}
            onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-primary)' }}>
        <Outlet />
      </main>
    </div>
  );
}

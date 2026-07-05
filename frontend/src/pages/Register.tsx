import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi, setAuthToken } from '../api/client';
import { supabase } from '../lib/supabase';

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      // Call backend /auth/register — this creates the public.users profile row
      // with the name and returns a JWT token.
      const result = await authApi.register({ email, password, name: name || undefined });

      if (result.token) {
        // Session returned immediately (email confirmation disabled in Supabase)
        setAuthToken(result.token);

        // Sync the Supabase client session so AuthContext picks it up
        await supabase.auth.setSession({
          access_token: result.token,
          refresh_token: '',
        });

        navigate('/');
      } else {
        // Supabase requires email confirmation — show a success message
        setSuccessMsg(
          'Account created! Please check your email to confirm your address, then sign in.'
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(108,99,255,0.15) 0%, transparent 70%)',
    }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: '56px', height: '56px',
            background: 'linear-gradient(135deg, #6c63ff, #8b5cf6)',
            borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
            boxShadow: '0 8px 32px rgba(108,99,255,0.4)',
            fontSize: '1.5rem',
          }}>⚡</div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>Create Account</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Get started with JobScheduler
          </p>
        </div>

        <div className="card" style={{ padding: '2rem' }}>
          {error && <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>{error}</div>}
          {successMsg && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>{successMsg}</div>}

          {!successMsg && (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="register-name">Name</label>
                <input
                  id="register-name"
                  type="text"
                  className="input"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="register-email">Email</label>
                <input
                  id="register-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="register-password">Password</label>
                <input
                  id="register-password"
                  type="password"
                  className="input"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <button
                id="register-submit"
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
                disabled={isLoading}
              >
                {isLoading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Creating...</> : 'Create Account'}
              </button>
            </form>
          )}

          {successMsg && (
            <Link
              to="/login"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem', display: 'flex' }}
            >
              Go to Sign In
            </Link>
          )}

          <p style={{ textAlign: 'center', marginTop: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

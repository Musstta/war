import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { C, T } from '../styles';

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...T.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 320 }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' }}>WAR</h1>
        <p style={{ color: C.muted, marginBottom: '2rem', fontSize: '0.85rem' }}>Sign in to continue</p>

        {params.get('registered') && (
          <div style={{ ...T.infoBox, marginBottom: '1rem' }}>Account created — sign in below.</div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={T.label}>Username</label>
            <input
              style={T.input} type="text" autoFocus autoComplete="username"
              value={username} onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label style={T.label}>Password</label>
            <input
              style={T.input} type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div style={T.errorBox}>{error}</div>}
          <button type="submit" disabled={loading} style={{ ...T.btn, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', color: C.muted, fontSize: '0.85rem', textAlign: 'center' }}>
          New here?{' '}
          <Link to="/register" style={{ color: C.accent, textDecoration: 'none' }}>Create account</Link>
        </p>
      </div>
    </div>
  );
}

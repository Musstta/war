import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { C, T } from '../styles';

export function RegisterScreen() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.register(username, password);
      navigate('/login?registered=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...T.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 320 }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' }}>WAR</h1>
        <p style={{ color: C.muted, marginBottom: '2rem', fontSize: '0.85rem' }}>Create account</p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={T.label}>Username</label>
            <input
              style={T.input} type="text" autoFocus autoComplete="username"
              value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="3–32 characters"
            />
          </div>
          <div>
            <label style={T.label}>Password</label>
            <input
              style={T.input} type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="min 4 characters"
            />
          </div>
          {error && <div style={T.errorBox}>{error}</div>}
          <button type="submit" disabled={loading} style={{ ...T.btn, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', color: C.muted, fontSize: '0.85rem', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: C.accent, textDecoration: 'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

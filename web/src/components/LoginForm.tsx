import { useState } from 'react';
import { api } from '../api';

interface Props {
  onLogin: () => void;
}

export function LoginForm({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(username, password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#1a1a2e', color: '#eee',
      fontFamily: 'monospace',
    }}>
      <h1 style={{ marginBottom: '0.25rem', fontSize: '2rem', letterSpacing: '0.1em' }}>WAR</h1>
      <p style={{ color: '#888', marginBottom: '2rem', fontSize: '0.85rem' }}>Central America — Strategy</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 220 }}>
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <span style={{ color: '#f66', fontSize: '0.8rem' }}>{error}</span>}
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? 'Logging in…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#16213e', border: '1px solid #444', borderRadius: 4,
  color: '#eee', padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.9rem',
};

const btnStyle: React.CSSProperties = {
  background: '#0f3460', border: 'none', borderRadius: 4, color: '#eee',
  padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.9rem', cursor: 'pointer',
};

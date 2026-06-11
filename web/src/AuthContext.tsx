import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface AuthUser {
  username: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Session is managed server-side via httpOnly cookie (credentials:'include' on all fetches).
// We store the username in localStorage only for display purposes — actual auth state is
// determined by whether /api/me succeeds, not by presence of this value.
const USERNAME_KEY = 'war_username';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: check if session cookie is still valid
  useEffect(() => {
    const stored = localStorage.getItem(USERNAME_KEY);
    if (!stored) { setLoading(false); return; }
    // Verify with a lightweight call; /api/auth/login won't work here, use /api/me
    // which requires a legacy-world nation. For multi-game users /api/me may 404,
    // so we accept either success OR a 404 as "session is alive" — only a 401 means logged out.
    fetch('/api/me', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem(USERNAME_KEY); setUser(null); }
        else setUser({ username: stored });
      })
      .catch(() => setUser({ username: stored }))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await api.authLogin(username, password);
    localStorage.setItem(USERNAME_KEY, username);
    setUser({ username });
  }, []);

  const logout = useCallback(async () => {
    await api.authLogout().catch(() => {});
    localStorage.removeItem(USERNAME_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

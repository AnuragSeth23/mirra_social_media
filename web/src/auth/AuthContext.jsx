import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSignedOutHandler } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  // Restore the session from the refresh cookie on load.
  useEffect(() => {
    refreshSession()
      .then((s) => {
        setUser(s?.user ?? null);
        setStatus(s ? 'signedIn' : 'signedOut');
      })
      .catch(() => setStatus('signedOut'));
  }, []);

  // If the server stops accepting this session (signed out on another device, password changed), go back to sign-in.
  useEffect(() => {
    setSignedOutHandler(() => {
      setUser(null);
      setStatus('signedOut');
    });
    return () => setSignedOutHandler(null);
  }, []);

  const acceptSession = useCallback((s) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST' });
    } catch (err) {
      // "Log out everywhere" that failed must not look like it worked: stay signed in and say so.
      if (everywhere) throw err;
    }
    setAccessToken(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api('/users/me'));
  }, []);

  const value = useMemo(() => ({ status, user, acceptSession, signOut, refreshUser }), [status, user, acceptSession, signOut, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not sign you in.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="staff-email">Work email</label>
        <input
          id="staff-email"
          className="input"
          type="email"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field" style={{ marginBottom: 20 }}>
        <label htmlFor="staff-password">Password</label>
        <input
          id="staff-password"
          className="input"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary btn-block" style={{ padding: 11 }} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" /> Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  );
}

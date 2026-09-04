'use client';

import { useState } from 'react';
import { api, ApiRequestError } from '@/lib/client';

/** Changing your own password. Every signed-in staff member can reach this. */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const ready = current.length > 0 && next.length >= 8 && next === confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api('/api/staff/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setNotice({ kind: 'ok', message: 'Password changed. Use the new one next time you sign in.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof ApiRequestError ? error.message : 'Could not change your password.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      {notice && (
        <div className={notice.kind === 'ok' ? 'banner banner-ok' : 'banner banner-error'} style={{ marginBottom: 16 }}>
          {notice.message}
        </div>
      )}

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="pw-new">New password</label>
        <input
          id="pw-new"
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          aria-invalid={tooShort}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        {tooShort && <div className="field-error">Use at least 8 characters.</div>}
      </div>

      <div className="field" style={{ marginBottom: 20 }}>
        <label htmlFor="pw-confirm">Repeat the new password</label>
        <input
          id="pw-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {mismatch && <div className="field-error">These do not match.</div>}
      </div>

      <button className="btn btn-primary" style={{ padding: '10px 18px' }} disabled={busy || !ready}>
        {busy ? (
          <>
            <span className="spinner" /> Changing…
          </>
        ) : (
          'Change password'
        )}
      </button>
    </form>
  );
}

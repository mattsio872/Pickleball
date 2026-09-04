'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

export function JoinForm({ bookingRef, full }: { bookingRef: string; full: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (full) {
    return (
      <div className="banner banner-warn">
        This party is already full. Ask the booker to have you added at the front desk instead.
      </div>
    );
  }

  if (done) {
    return (
      <div className="banner banner-ok">
        You&rsquo;re on the roster. Turn up with the group — the booker&rsquo;s QR gets you all in.
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/join/${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        body: JSON.stringify({ name, contact }),
      });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not add you to the roster.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          className="input"
          value={name}
          autoComplete="name"
          placeholder="Maria Reyes"
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <div className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="join-contact">Mobile number (optional)</label>
        <input
          id="join-contact"
          className="input"
          value={contact}
          inputMode="tel"
          autoComplete="tel"
          placeholder="0917 000 0000"
          onChange={(e) => setContact(e.target.value)}
        />
      </div>
      <button className="btn btn-primary btn-block" style={{ padding: 11 }} disabled={busy || name.trim().length < 2}>
        {busy ? (
          <>
            <span className="spinner" /> Adding you…
          </>
        ) : (
          'Add me to the roster'
        )}
      </button>
    </form>
  );
}

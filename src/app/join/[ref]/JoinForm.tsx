'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

export function JoinForm({ bookingRef }: { bookingRef: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState<string | null>(null);

  if (pass) {
    return (
      <div className="banner banner-ok">
        You&rsquo;re on the roster, and you have a pass of your own — taking you to it now. If nothing
        happens, <Link href={pass}>open your pass</Link>.
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ passPath: string }>(`/api/join/${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        body: JSON.stringify({ name, contact }),
      });
      setPass(created.passPath);
      router.push(created.passPath);
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

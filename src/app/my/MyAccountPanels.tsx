'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

function Notice({ state }: { state: { kind: 'ok' | 'error'; message: string } | null }) {
  if (!state) return null;
  return (
    <div className={state.kind === 'ok' ? 'banner banner-ok' : 'banner banner-error'} style={{ marginBottom: 16 }}>
      {state.message}
    </div>
  );
}

/** Attach a booking made before this account existed, using its reference. */
export function ClaimBooking() {
  const router = useRouter();
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNotice(null);
        try {
          const result = await api<{ ref: string; court: string }>('/api/customer/claim', {
            method: 'POST',
            body: JSON.stringify({ ref }),
          });
          setNotice({ kind: 'ok', message: `${result.ref} (${result.court}) added to your account.` });
          setRef('');
          router.refresh();
        } catch (error) {
          setNotice({
            kind: 'error',
            message: error instanceof ApiRequestError ? error.message : 'Could not add that booking.',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Notice state={notice} />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="claim-ref">Booking reference</label>
          <input
            id="claim-ref"
            className="input mono"
            value={ref}
            placeholder="PL-K7Q2M9"
            onChange={(e) => setRef(e.target.value.toUpperCase())}
          />
        </div>
        <button className="btn btn-secondary" disabled={busy || ref.trim().length < 3}>
          {busy ? 'Adding…' : 'Add to my account'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10, maxWidth: '52ch' }}>
        Booked before you made an account? The reference is on your pass and in your confirmation email. We ask for it
        rather than matching your email address, so nobody can read your bookings by guessing where you booked from.
      </p>
    </form>
  );
}

/** Saved details, and the password. */
export function ProfilePanel({ initial }: { initial: { name: string; email: string; mobile: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [mobile, setMobile] = useState(initial.mobile);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const changingPassword = newPassword.length > 0;

  return (
    <form
      style={{ maxWidth: 460 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNotice(null);
        try {
          await api('/api/customer/profile', {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              mobile,
              ...(changingPassword ? { currentPassword, newPassword } : {}),
            }),
          });
          setNotice({
            kind: 'ok',
            message: changingPassword ? 'Details and password saved.' : 'Details saved.',
          });
          setCurrentPassword('');
          setNewPassword('');
          router.refresh();
        } catch (error) {
          setNotice({
            kind: 'error',
            message: error instanceof ApiRequestError ? error.message : 'Could not save your details.',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Notice state={notice} />

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="my-name">Name</label>
        <input id="my-name" className="input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="my-mobile">Mobile number</label>
        <input
          id="my-mobile"
          className="input"
          value={mobile}
          autoComplete="tel"
          inputMode="tel"
          onChange={(e) => setMobile(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="my-email">Email address</label>
        <input id="my-email" className="input" value={initial.email} disabled />
        <p className="muted" style={{ fontSize: 12, marginTop: 5 }}>
          Your bookings are tied to this address. Message the desk if it needs changing.
        </p>
      </div>

      <hr className="hr" style={{ margin: '4px 0 18px' }} />

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="my-newpw">New password (leave blank to keep the current one)</label>
        <input
          id="my-newpw"
          className="input"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      {changingPassword && (
        <div className="field" style={{ marginBottom: 18 }}>
          <label htmlFor="my-curpw">Current password</label>
          <input
            id="my-curpw"
            className="input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ padding: '10px 18px' }}
        disabled={busy || (changingPassword && (newPassword.length < 8 || currentPassword.length === 0))}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

export function CustomerSignOut() {
  const router = useRouter();
  return (
    <button
      className="btn btn-secondary"
      onClick={async () => {
        await fetch('/api/customer/logout', { method: 'POST' });
        router.push('/');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

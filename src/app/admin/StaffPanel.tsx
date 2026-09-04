'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

type Staff = {
  id: string;
  email: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  lastLoginAt: string | null;
  createdAt: string;
};

function Notice({ state }: { state: { kind: 'ok' | 'error'; message: string } | null }) {
  if (!state) return null;
  return (
    <div className={state.kind === 'ok' ? 'banner banner-ok' : 'banner banner-error'} style={{ marginBottom: 16 }}>
      {state.message}
    </div>
  );
}

function formatWhen(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function StaffPanel({ initial, currentUserId }: { initial: Staff[]; currentUserId: string }) {
  const router = useRouter();
  const [staff, setStaff] = useState(initial);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [adding, setAdding] = useState({ email: '', name: '', role: 'STAFF' as const, password: '' });
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    const { staff: next } = await api<{ staff: Staff[] }>('/api/admin/staff');
    setStaff(next);
    router.refresh();
  }

  async function act(fn: () => Promise<void>, okMessage: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      await refresh();
      setNotice({ kind: 'ok', message: okMessage });
      return true;
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof ApiRequestError ? error.message : 'That did not work.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const adminCount = staff.filter((s) => s.role === 'ADMIN').length;

  return (
    <div>
      <Notice state={notice} />

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Last signed in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => {
              const isSelf = person.id === currentUserId;
              const lastAdmin = person.role === 'ADMIN' && adminCount === 1;
              return (
                <tr key={person.id}>
                  <td>
                    {person.name}
                    {isSelf && <span className="muted"> (you)</span>}
                  </td>
                  <td className="muted">{person.email}</td>
                  <td>
                    <select
                      className="input"
                      style={{ minHeight: 30, padding: '3px 8px', fontSize: 13, width: 'auto' }}
                      value={person.role}
                      disabled={busy || lastAdmin}
                      title={lastAdmin ? 'The only admin — promote somebody else first.' : undefined}
                      onChange={(e) =>
                        void act(
                          async () => {
                            await api('/api/admin/staff', {
                              method: 'PATCH',
                              body: JSON.stringify({ id: person.id, role: e.target.value }),
                            });
                          },
                          `${person.name} is now ${e.target.value === 'ADMIN' ? 'an admin' : 'front desk staff'}.`,
                        )
                      }
                    >
                      <option value="STAFF">Front desk</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {formatWhen(person.lastLoginAt)}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setResetting(resetting === person.id ? null : person.id);
                        setResetPassword('');
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ marginLeft: 6 }}
                      disabled={busy || isSelf || lastAdmin}
                      title={
                        isSelf
                          ? 'You cannot remove your own account.'
                          : lastAdmin
                            ? 'The only admin — promote somebody else first.'
                            : undefined
                      }
                      onClick={() => {
                        if (!confirm(`Remove ${person.name} (${person.email})? They will lose access immediately.`)) return;
                        void act(async () => {
                          await api(`/api/admin/staff?id=${encodeURIComponent(person.id)}`, { method: 'DELETE' });
                        }, `${person.email} removed.`);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {resetting && (
        <form
          className="row"
          style={{ marginBottom: 18, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            const person = staff.find((s) => s.id === resetting);
            void act(async () => {
              await api('/api/admin/staff', {
                method: 'PATCH',
                body: JSON.stringify({ id: resetting, password: resetPassword }),
              });
            }, `Password reset for ${person?.email}. Tell them the new one.`).then((ok) => {
              if (ok) {
                setResetting(null);
                setResetPassword('');
              }
            });
          }}
        >
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="reset-pw">
              New password for {staff.find((s) => s.id === resetting)?.email}
            </label>
            <input
              id="reset-pw"
              className="input"
              type="text"
              value={resetPassword}
              placeholder="At least 8 characters"
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" disabled={busy || resetPassword.length < 8}>
            Set password
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setResetting(null)}>
            Cancel
          </button>
        </form>
      )}

      {!showAdd ? (
        <button className="btn btn-secondary" onClick={() => setShowAdd(true)}>
          Add a staff account
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('/api/admin/staff', { method: 'POST', body: JSON.stringify(adding) });
            }, `${adding.email} added.`).then((ok) => {
              if (ok) {
                setAdding({ email: '', name: '', role: 'STAFF', password: '' });
                setShowAdd(false);
              }
            });
          }}
        >
          <h5 style={{ marginBottom: 10 }}>Add a staff account</h5>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
            <div className="field">
              <label htmlFor="new-name">Name</label>
              <input
                id="new-name"
                className="input"
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-email">Work email</label>
              <input
                id="new-email"
                className="input"
                type="email"
                value={adding.email}
                onChange={(e) => setAdding({ ...adding, email: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-role">Role</label>
              <select
                id="new-role"
                className="input"
                value={adding.role}
                onChange={(e) => setAdding({ ...adding, role: e.target.value as 'STAFF' })}
              >
                <option value="STAFF">Front desk</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="new-pw">Initial password</label>
              <input
                id="new-pw"
                className="input"
                type="text"
                value={adding.password}
                placeholder="At least 8 characters"
                onChange={(e) => setAdding({ ...adding, password: e.target.value })}
                required
              />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 14px' }}>
            Give them this password directly. They can change it themselves under their own account.
          </p>
          <button className="btn btn-primary" style={{ padding: '10px 18px' }} disabled={busy}>
            Create account
          </button>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setShowAdd(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

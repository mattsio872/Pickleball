'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, formatPesoClient } from '@/lib/client';

type Booking = {
  id: string;
  ref: string;
  status: 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  courtId: string;
  court: string;
  slot: string;
  dayKey: string;
  startMinutes: number;
  durationMinutes: number;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
  players: number;
  paid: boolean;
  paidCents: number;
  hasAccount: boolean;
};

type Court = { id: string; code: string; name: string };
type Settings = { timezone: string; openHour: number; closeHour: number; durationsMinutes: number[] };
type Notice = { kind: 'ok' | 'error' | 'warn'; message: string } | null;

function timeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

/**
 * Look a booking up and change it.
 *
 * Three actions with very different consequences, so they are presented as
 * three distinct things rather than one "edit" that quietly does all of them:
 * move it, release the court, or delete the row.
 */
export function BookingsManager({ isAdmin, initialSearch = '' }: { isAdmin: boolean; initialSearch?: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<Booking>>({});

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      const result = await api<{ bookings: Booking[]; courts: Court[]; settings: Settings }>(
        `/api/desk/bookings${params}`,
      );
      setBookings(result.bookings);
      setCourts(result.courts);
      setSettings(result.settings);
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof ApiRequestError ? error.message : 'Could not load bookings.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(search), 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  async function run(fn: () => Promise<Notice>) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fn();
      await load(search);
      setNotice(result);
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof ApiRequestError ? error.message : 'That did not work.',
      });
    } finally {
      setBusy(false);
    }
  }

  const startHours = settings
    ? Array.from({ length: settings.closeHour - settings.openHour }, (_, i) => (settings.openHour + i) * 60)
    : [];

  return (
    <div>
      {notice && (
        <div
          className={
            notice.kind === 'ok' ? 'banner banner-ok' : notice.kind === 'warn' ? 'banner banner-warn' : 'banner banner-error'
          }
          style={{ marginBottom: 18 }}
        >
          {notice.message}
        </div>
      )}

      <div className="field" style={{ marginBottom: 20, maxWidth: 380 }}>
        <label htmlFor="bk-search">Find a booking</label>
        <input
          id="bk-search"
          className="input"
          value={search}
          placeholder="Reference, name, email or mobile — blank for what is still ahead"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {loading ? 'Loading…' : `${bookings.length} booking${bookings.length === 1 ? '' : 's'}.`}
      </p>

      {!loading && bookings.length === 0 && (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {search.trim() ? 'Nothing matches that.' : 'Nothing booked ahead of now.'}
        </p>
      )}

      <div className="stack" style={{ gap: 12 }}>
        {bookings.map((booking) => {
          const isEditing = editing === booking.id;
          const live = booking.status === 'HELD' || booking.status === 'CONFIRMED';

          return (
            <div
              key={booking.id}
              style={{
                background: 'var(--color-surface)',
                borderRadius: 12,
                padding: 18,
                boxShadow: 'var(--shadow-sm)',
                opacity: live ? 1 : 0.72,
              }}
            >
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="tag tag-neutral mono">{booking.ref}</span>
                {booking.status === 'CONFIRMED' && <span className="tag tag-accent">Paid</span>}
                {booking.status === 'HELD' && <span className="tag tag-outline">Unpaid hold</span>}
                {booking.status === 'CANCELLED' && <span className="tag tag-outline">Released</span>}
                {booking.status === 'EXPIRED' && <span className="tag tag-neutral">Expired</span>}
                {booking.hasAccount && <span className="tag tag-accent-2">Has account</span>}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-heading)' }}>
                  {formatPesoClient(booking.totalCents)}
                </span>
              </div>

              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>{booking.court}</div>
              <div className="muted" style={{ fontSize: 13.5, marginBottom: 4 }}>
                {booking.slot}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {booking.customerName} · {booking.customerMobile} · {booking.customerEmail} · {booking.players}{' '}
                {booking.players === 1 ? 'player' : 'players'}
              </div>

              <div className="row" style={{ marginTop: 14 }}>
                {live && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(isEditing ? null : booking.id);
                      setDraft(booking);
                    }}
                  >
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                )}

                {live && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !confirm(
                          `Release ${booking.ref}?\n\nThe court goes back on sale immediately and the booking record is kept.` +
                            (booking.paid
                              ? `\n\nThis booking was paid ${formatPesoClient(booking.paidCents)}. Releasing it does NOT refund anything — do that in PayMongo.`
                              : ''),
                        )
                      )
                        return;
                      void run(async () => {
                        const result = await api<{ wasPaid: boolean; paidCents: number }>('/api/desk/bookings', {
                          method: 'POST',
                          body: JSON.stringify({ bookingId: booking.id, action: 'release' }),
                        });
                        setEditing(null);
                        return result.wasPaid
                          ? {
                              kind: 'warn',
                              message: `${booking.ref} released and the court is back on sale. ${formatPesoClient(result.paidCents)} was paid — refund it in PayMongo if the party is owed it.`,
                            }
                          : { kind: 'ok', message: `${booking.ref} released. The court is back on sale.` };
                      });
                    }}
                  >
                    Release the court
                  </button>
                )}

                {booking.status === 'CANCELLED' && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api('/api/desk/bookings', {
                          method: 'POST',
                          body: JSON.stringify({ bookingId: booking.id, action: 'restore' }),
                        });
                        return { kind: 'ok', message: `${booking.ref} put back.` };
                      })
                    }
                  >
                    Put it back
                  </button>
                )}

                {isAdmin && (
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    disabled={busy}
                    onClick={() => {
                      const warning = booking.paid
                        ? `Delete ${booking.ref} permanently?\n\nThis booking was PAID ${formatPesoClient(booking.paidCents)}. Deleting it destroys the payment record — the venue will have no proof of what it took. "Release the court" keeps the record.\n\nDelete anyway?`
                        : `Delete ${booking.ref} permanently? This cannot be undone.`;
                      if (!confirm(warning)) return;
                      void run(async () => {
                        await api(
                          `/api/desk/bookings?id=${encodeURIComponent(booking.id)}${booking.paid ? '&force=true' : ''}`,
                          { method: 'DELETE' },
                        );
                        setEditing(null);
                        return { kind: 'ok', message: `${booking.ref} deleted.` };
                      });
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>

              {isEditing && settings && (
                <form
                  style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-divider)' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await api<{
                        slotChanged: boolean;
                        priceChange: { fromCents: number; toCents: number } | null;
                        emailed: boolean;
                      }>('/api/desk/bookings', {
                        method: 'PATCH',
                        body: JSON.stringify({
                          bookingId: booking.id,
                          courtId: draft.courtId,
                          date: draft.dayKey,
                          startMinutes: draft.startMinutes,
                          durationMinutes: draft.durationMinutes,
                          customerName: draft.customerName,
                          customerEmail: draft.customerEmail,
                          customerMobile: draft.customerMobile,
                        }),
                      });
                      setEditing(null);

                      const bits = [`${booking.ref} updated.`];
                      if (result.priceChange) {
                        const delta = result.priceChange.toCents - result.priceChange.fromCents;
                        bits.push(
                          delta > 0
                            ? `The price rose by ${formatPesoClient(delta)} — collect it at the desk.`
                            : `The price fell by ${formatPesoClient(-delta)} — refund it in PayMongo if owed.`,
                        );
                      }
                      if (result.emailed) bits.push('An updated pass has been emailed.');
                      return { kind: result.priceChange ? 'warn' : 'ok', message: bits.join(' ') };
                    });
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                    <div className="field">
                      <label htmlFor={`court-${booking.id}`}>Court</label>
                      <select
                        id={`court-${booking.id}`}
                        className="input"
                        value={draft.courtId}
                        onChange={(e) => setDraft({ ...draft, courtId: e.target.value })}
                      >
                        {courts.map((c) => (
                          <option key={c.id} value={c.id}>
                            Court {c.code} · {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`date-${booking.id}`}>Date</label>
                      <input
                        id={`date-${booking.id}`}
                        className="input"
                        type="date"
                        value={draft.dayKey}
                        onChange={(e) => setDraft({ ...draft, dayKey: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`start-${booking.id}`}>Start</label>
                      <select
                        id={`start-${booking.id}`}
                        className="input"
                        value={draft.startMinutes}
                        onChange={(e) => setDraft({ ...draft, startMinutes: Number(e.target.value) })}
                      >
                        {startHours.map((m) => (
                          <option key={m} value={m}>
                            {timeLabel(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`dur-${booking.id}`}>Length</label>
                      <select
                        id={`dur-${booking.id}`}
                        className="input"
                        value={draft.durationMinutes}
                        onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}
                      >
                        {settings.durationsMinutes.map((m) => (
                          <option key={m} value={m}>
                            {m / 60} {m === 60 ? 'hour' : 'hours'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`name-${booking.id}`}>Booker</label>
                      <input
                        id={`name-${booking.id}`}
                        className="input"
                        value={draft.customerName ?? ''}
                        onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`mob-${booking.id}`}>Mobile</label>
                      <input
                        id={`mob-${booking.id}`}
                        className="input"
                        value={draft.customerMobile ?? ''}
                        onChange={(e) => setDraft({ ...draft, customerMobile: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`mail-${booking.id}`}>Email</label>
                      <input
                        id={`mail-${booking.id}`}
                        className="input"
                        type="email"
                        value={draft.customerEmail ?? ''}
                        onChange={(e) => setDraft({ ...draft, customerEmail: e.target.value })}
                      />
                    </div>
                  </div>

                  <p className="muted" style={{ fontSize: 12, margin: '12px 0 14px', maxWidth: '62ch' }}>
                    Moving a confirmed booking emails the party an updated pass. The price follows the rate captured
                    when they booked, so a later rate change never re-bills them — but a longer or shorter block does
                    change what they owe, and that is settled at the desk or in PayMongo.
                  </p>

                  <button className="btn btn-primary" style={{ padding: '10px 18px' }} disabled={busy}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

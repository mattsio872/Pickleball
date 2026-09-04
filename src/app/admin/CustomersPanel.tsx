'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, formatPesoClient } from '@/lib/client';

type Customer = {
  email: string;
  name: string;
  mobile: string;
  bookings: number;
  confirmedBookings: number;
  totalSpentCents: number;
  firstBookedAt: string;
  lastBookedAt: string;
  upcomingAt: string | null;
};

type HistoryRow = {
  ref: string;
  status: string;
  court: string;
  slot: string;
  totalCents: number;
  players: number;
};

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Everyone who has booked, grouped by the email they booked with.
 *
 * There are no customer logins, so this is a read-only directory built from
 * bookings — the venue's answer to "who is this person and what have they
 * booked before" when somebody rings the desk.
 */
export function CustomersPanel({ initial, initialTotal }: { initial: Customer[]; initialTotal: number }) {
  const [customers, setCustomers] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryRow[]>>({});

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      const result = await api<{ customers: Customer[]; total: number }>(`/api/admin/customers${params}`);
      setCustomers(result.customers);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(search), 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  async function toggle(email: string) {
    if (expanded === email) {
      setExpanded(null);
      return;
    }
    setExpanded(email);
    if (history[email]) return;
    try {
      const result = await api<{ bookings: HistoryRow[] }>(
        `/api/admin/customers?email=${encodeURIComponent(email)}`,
      );
      setHistory((h) => ({ ...h, [email]: result.bookings }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not load that history.');
    }
  }

  return (
    <div>
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="field" style={{ marginBottom: 18, maxWidth: 360 }}>
        <label htmlFor="cust-search">Search by name, email, mobile or booking reference</label>
        <input
          id="cust-search"
          className="input"
          value={search}
          placeholder="e.g. Juan, 0917, or PL-K7Q2M9"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        {loading ? 'Searching…' : `${total} customer${total === 1 ? '' : 's'}${search.trim() ? ' matching' : ''}.`}
      </p>

      {customers.length === 0 && !loading ? (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          {search.trim() ? 'Nobody matches that.' : 'Nobody has booked yet.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Bookings</th>
                <th>Next</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <Fragment key={c.email}>
                  <tr>
                    <td>{c.name}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {c.email}
                      <br />
                      {c.mobile}
                    </td>
                    <td>
                      {c.confirmedBookings} confirmed
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        since {shortDate(c.firstBookedAt)}
                      </span>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {c.upcomingAt ? (
                        <span className="tag tag-accent">{shortDate(c.upcomingAt)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatPesoClient(c.totalSpentCents)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost" onClick={() => void toggle(c.email)}>
                        {expanded === c.email ? 'Hide' : 'History'}
                      </button>
                    </td>
                  </tr>
                  {expanded === c.email && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--color-neutral-100)' }}>
                        {!history[c.email] ? (
                          <span className="muted" style={{ fontSize: 13 }}>
                            Loading…
                          </span>
                        ) : (
                          <div className="stack" style={{ gap: 6, padding: '4px 0' }}>
                            {history[c.email].map((b) => (
                              <div key={b.ref} className="row" style={{ fontSize: 13, gap: 14 }}>
                                <span className="mono">{b.ref}</span>
                                <span
                                  className={b.status === 'CONFIRMED' ? 'tag tag-accent' : 'tag tag-neutral'}
                                >
                                  {b.status.toLowerCase()}
                                </span>
                                <span>{b.court}</span>
                                <span className="muted">{b.slot}</span>
                                <span style={{ marginLeft: 'auto' }}>{formatPesoClient(b.totalCents)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

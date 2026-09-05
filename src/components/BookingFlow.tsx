'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError, formatPesoClient } from '@/lib/client';

/**
 * The two-step booking flow from the design: pick a slot, then pay.
 *
 * Availability is re-fetched whenever the day or the duration changes, and
 * again right before the hold is placed, so a slot that somebody else took
 * while this page sat open is shown as taken rather than failing at payment.
 */

type SlotView = {
  startMinutes: number;
  label: string;
  available: boolean;
  reason: 'booked' | 'closed' | 'past' | 'after-hours' | null;
};

type CourtView = {
  id: string;
  code: string;
  name: string;
  blurb: string;
  meta: string;
  slots: SlotView[];
};

type Settings = {
  venueName: string;
  city: string;
  timezone: string;
  hourlyRateCents: number;
  durationsMinutes: number[];
  maxPlayers: number;
  holdMinutes: number;
};

type Availability = {
  dayKey: string;
  durationMinutes: number;
  totalCents: number;
  hourlyRateCents: number;
  courts: CourtView[];
  settings: Settings;
  days: string[];
};

const METHODS = [
  { id: 'gcash', name: 'GCash', note: 'e-wallet · instant' },
  { id: 'paymaya', name: 'Maya', note: 'e-wallet · instant' },
  { id: 'dob', name: 'Online bank', note: 'InstaPay · PESONet' },
  { id: 'card', name: 'Card', note: 'Visa · Mastercard' },
] as const;

type MethodId = (typeof METHODS)[number]['id'];

const REASON_TEXT: Record<NonNullable<SlotView['reason']>, string> = {
  booked: 'Already booked',
  closed: 'Court closed',
  past: 'Already started',
  'after-hours': 'Runs past closing',
};

function durationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function dayChipLabels(dayKey: string, timezone: string, isToday: boolean) {
  // The key is a venue-local calendar date; parse it as such rather than
  // letting the browser apply its own zone to a bare date string.
  const [y, m, d] = dayKey.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = isToday
    ? 'TODAY'
    : noonUtc.toLocaleDateString('en-PH', { weekday: 'short', timeZone: timezone }).toUpperCase();
  return { dow, dom: d };
}

export function BookingFlow({
  cancelledRef,
  account,
}: {
  cancelledRef?: string;
  /**
   * The signed-in booker. Booking requires an account, so this is always
   * present — the pass goes to this address, and the name and number here are
   * what the account has saved.
   */
  account: { name: string; email: string; mobile: string };
}) {
  const router = useRouter();

  const [step, setStep] = useState<'slot' | 'pay'>('slot');
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [startMinutes, setStartMinutes] = useState<number | null>(null);

  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState(account.name);
  const [mobile, setMobile] = useState(account.mobile);
  const [method, setMethod] = useState<MethodId>('gcash');

  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const load = useCallback(
    async (day: string | null, mins: number | null, opts?: { keepSelection?: boolean }) => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (day) params.set('date', day);
        if (mins) params.set('duration', String(mins));
        const next = await api<Availability>(`/api/availability?${params.toString()}`);
        setData(next);
        setDayKey(next.dayKey);
        setDuration(next.durationMinutes);

        // Keep the chosen court if it still exists, otherwise fall back.
        setCourtId((current) => {
          if (opts?.keepSelection && current && next.courts.some((c) => c.id === current)) return current;
          return current && next.courts.some((c) => c.id === current) ? current : (next.courts[0]?.id ?? null);
        });

        // A start time that is no longer offered must not survive a reload.
        setStartMinutes((current) => {
          if (current === null) return null;
          const court = next.courts.find((c) => c.id === (courtId ?? next.courts[0]?.id));
          const slot = court?.slots.find((s) => s.startMinutes === current);
          return slot?.available ? current : null;
        });
      } catch (error) {
        setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load availability.');
      } finally {
        setLoading(false);
      }
    },
    [courtId],
  );

  useEffect(() => {
    void load(null, null);
    // Deliberately once on mount; subsequent loads are driven by the pickers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = data?.settings;
  const court = useMemo(
    () => data?.courts.find((c) => c.id === courtId) ?? data?.courts[0] ?? null,
    [data, courtId],
  );
  const slot = court?.slots.find((s) => s.startMinutes === startMinutes) ?? null;
  const ready = Boolean(court && slot?.available && duration && dayKey);

  const totalCents = data?.totalCents ?? 0;

  const endLabel = useMemo(() => {
    if (startMinutes === null || !duration) return null;
    const end = startMinutes + duration;
    const h24 = Math.floor(end / 60) % 24;
    const min = end % 60;
    const suffix = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
  }, [startMinutes, duration]);

  const dateLine = useMemo(() => {
    if (!dayKey || !settings) return '—';
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: settings.timezone,
    });
  }, [dayKey, settings]);

  async function handlePay() {
    if (!ready || !court || startMinutes === null || !duration || !dayKey) return;
    setSubmitting(true);
    setPayError(null);
    setFieldErrors({});

    try {
      const booking = await api<{ id: string }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          courtId: court.id,
          date: dayKey,
          startMinutes,
          durationMinutes: duration,
          name,
          mobile,
        }),
      });

      const checkout = await api<{ checkoutUrl: string }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ bookingId: booking.id, method }),
      });

      // Leaving for the payment provider (or the local sandbox page).
      window.location.href = checkout.checkoutUrl;
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiRequestError) {
        setPayError(error.message);
        if (error.failure.details) setFieldErrors(error.failure.details);
        if (error.failure.code === 'slot_taken') {
          // Show the fresh picture and send them back to choose again.
          setStartMinutes(null);
          setStep('slot');
          void load(dayKey, duration, { keepSelection: true });
        }
      } else {
        setPayError('Something went wrong. Please try again.');
      }
    }
  }

  const detailsValid = name.trim().length >= 2 && mobile.trim().length >= 7;

  return (
    <div className="container fade-in" style={{ padding: '32px 24px 64px' }}>
      <div className="wizard">
        {[
          { n: '1', label: 'Slot', on: true },
          { n: '2', label: 'Payment', on: step === 'pay' },
          { n: '3', label: 'QR pass', on: false },
        ].map((w, i, all) => (
          <div key={w.n} className="wizard-step" data-on={w.on}>
            <span className="n">{w.n}</span>
            <span className="lbl">{w.label}</span>
            {i < all.length - 1 && <span className="sep" />}
          </div>
        ))}
      </div>

      {cancelledRef && step === 'slot' && (
        <div className="banner banner-warn" style={{ marginBottom: 24 }}>
          Payment for <strong>{cancelledRef}</strong> was cancelled, so that hold has been released. Pick a slot to
          start again.
        </div>
      )}

      {loadError && (
        <div className="banner banner-error" style={{ marginBottom: 24 }}>
          {loadError}{' '}
          <button className="btn btn-ghost" onClick={() => void load(dayKey, duration)}>
            Retry
          </button>
        </div>
      )}

      {step === 'slot' ? (
        <div className="flow-grid">
          <div>
            <h2 style={{ marginBottom: 22 }}>Pick your slot</h2>

            <div style={{ marginBottom: 26 }}>
              <div className="label-caps" style={{ marginBottom: 10 }}>
                Date
              </div>
              <div className="chip-grid">
                {(data?.days ?? []).slice(0, 7).map((d, index) => {
                  const { dow, dom } = dayChipLabels(d, settings?.timezone ?? 'Asia/Manila', index === 0);
                  return (
                    <button
                      key={d}
                      type="button"
                      className="chip chip-day"
                      aria-pressed={d === dayKey}
                      onClick={() => {
                        setStartMinutes(null);
                        void load(d, duration, { keepSelection: true });
                      }}
                    >
                      <div className="dow">{dow}</div>
                      <div className="dom">{dom}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 26 }}>
              <div className="label-caps" style={{ marginBottom: 10 }}>
                Court
              </div>
              <div className="chip-grid">
                {(data?.courts ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip"
                    aria-pressed={c.id === court?.id}
                    onClick={() => {
                      setCourtId(c.id);
                      setStartMinutes(null);
                    }}
                  >
                    Court {c.code} · {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 26 }}>
              <div className="spread" style={{ marginBottom: 10 }}>
                <div className="label-caps">Start time</div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
                  {loading ? 'Checking availability…' : 'Dimmed slots are taken'}
                </div>
              </div>
              <div className="slot-grid" aria-busy={loading}>
                {(court?.slots ?? []).map((s) => (
                  <button
                    key={s.startMinutes}
                    type="button"
                    className="chip"
                    disabled={!s.available}
                    aria-pressed={s.startMinutes === startMinutes}
                    title={s.reason ? REASON_TEXT[s.reason] : undefined}
                    onClick={() => setStartMinutes(s.startMinutes)}
                  >
                    {s.label}
                  </button>
                ))}
                {!loading && court && court.slots.every((s) => !s.available) && (
                  <p className="muted" style={{ gridColumn: '1 / -1', fontSize: 13, margin: 0 }}>
                    Nothing free on this court today. Try another court or another date.
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="label-caps" style={{ marginBottom: 10 }}>
                Duration
              </div>
              <div className="chip-grid">
                {(settings?.durationsMinutes ?? []).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="chip"
                    aria-pressed={d === duration}
                    onClick={() => void load(dayKey, d, { keepSelection: true })}
                  >
                    {durationLabel(d)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="summary">
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              Your booking
            </div>
            <div className="stack" style={{ gap: 11 }}>
              <div className="summary-row">
                <span>Venue</span>
                <span>{settings?.venueName ?? '—'}</span>
              </div>
              <div className="summary-row">
                <span>Court</span>
                <span>{court ? `Court ${court.code} · ${court.name}` : '—'}</span>
              </div>
              <div className="summary-row">
                <span>Date</span>
                <span>{dateLine}</span>
              </div>
              <div className="summary-row">
                <span>Time</span>
                <span>{slot && endLabel ? `${slot.label} – ${endLabel}` : 'Pick a start time'}</span>
              </div>
              <div className="summary-row">
                <span>Players</span>
                <span>Up to {settings?.maxPlayers ?? 4}</span>
              </div>
            </div>
            <hr className="hr" style={{ margin: '18px 0' }} />
            <div className="spread">
              <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Total due</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 26 }}>{formatPesoClient(totalCents)}</span>
            </div>
            <button
              className="btn btn-primary btn-block"
              style={{ padding: 11 }}
              disabled={!ready}
              onClick={() => setStep('pay')}
            >
              Continue to payment
            </button>
            <button className="btn btn-ghost btn-block" style={{ padding: 8 }} onClick={() => router.push('/')}>
              Back to site
            </button>
          </aside>
        </div>
      ) : (
        <div className="flow-grid">
          <div>
            <h2 style={{ marginBottom: 4 }}>Pay to confirm</h2>
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 24 }}>
              Cashless only. Your slot is held for {settings?.holdMinutes ?? 10} minutes from the moment you continue
              to the payment provider.
            </p>

            <div className="banner banner-info" style={{ marginBottom: 22 }}>
              Filled in from your account, and saved to it. Correcting your name or number here updates your account
              too.
            </div>

            <div className="label-caps" style={{ marginBottom: 10 }}>
              Payment method
            </div>
            <div className="method-grid" style={{ marginBottom: 26 }}>
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip chip-method"
                  aria-pressed={m.id === method}
                  onClick={() => setMethod(m.id)}
                >
                  <span className="name">{m.name}</span>
                  <span className="note">{m.note}</span>
                </button>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
                gap: 14,
                marginBottom: 22,
              }}
            >
              <div className="field">
                <label htmlFor="bk-name">Full name</label>
                <input
                  id="bk-name"
                  className="input"
                  placeholder="Juan dela Cruz"
                  value={name}
                  autoComplete="name"
                  aria-invalid={Boolean(fieldErrors.name)}
                  onChange={(e) => setName(e.target.value)}
                />
                {fieldErrors.name && <div className="field-error">{fieldErrors.name[0]}</div>}
              </div>
              <div className="field">
                <label htmlFor="bk-mobile">Mobile number</label>
                <input
                  id="bk-mobile"
                  className="input"
                  placeholder="0917 000 0000"
                  value={mobile}
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={Boolean(fieldErrors.mobile)}
                  onChange={(e) => setMobile(e.target.value)}
                />
                {fieldErrors.mobile && <div className="field-error">{fieldErrors.mobile[0]}</div>}
              </div>
              <div className="field">
                <label htmlFor="bk-email">Email for the QR pass</label>
                {/* Fixed to the account: the pass and the booking history have
                    to end up in the same place, and a typo here would put them
                    somewhere nobody can reach. */}
                <input id="bk-email" className="input" value={account.email} type="email" readOnly disabled />
                <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>
                  Your account&rsquo;s address. Change it in your account settings.
                </div>
              </div>
            </div>

            {payError && (
              <div className="banner banner-error" style={{ marginBottom: 18 }}>
                {payError}
              </div>
            )}

            <div style={{ borderRadius: 8, padding: 18, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="label-caps" style={{ marginBottom: 10 }}>
                {METHODS.find((m) => m.id === method)?.name}
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
                You&rsquo;ll be taken to the provider&rsquo;s secure checkout to authorise the payment. We never see or
                store your wallet, bank or card credentials. Your booking is confirmed — and your QR pass issued — the
                moment the payment clears.
              </p>
            </div>
          </div>

          <aside className="summary">
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              Summary
            </div>
            <div className="stack" style={{ gap: 11 }}>
              <div className="summary-row">
                <span>Court</span>
                <span>{court ? `Court ${court.code} · ${court.name}` : '—'}</span>
              </div>
              <div className="summary-row">
                <span>Date</span>
                <span>{dateLine}</span>
              </div>
              <div className="summary-row">
                <span>Time</span>
                <span>{slot && endLabel ? `${slot.label} – ${endLabel}` : '—'}</span>
              </div>
              <div className="summary-row">
                <span>Rate</span>
                <span>
                  {formatPesoClient(data?.hourlyRateCents ?? 0)} × {(duration ?? 0) / 60}h
                </span>
              </div>
            </div>
            <hr className="hr" style={{ margin: '18px 0' }} />
            <div className="spread">
              <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Total</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 26 }}>{formatPesoClient(totalCents)}</span>
            </div>
            <button
              className="btn btn-primary btn-block"
              style={{ padding: 11 }}
              disabled={!detailsValid || submitting || !ready}
              onClick={() => void handlePay()}
            >
              {submitting ? (
                <>
                  <span className="spinner" /> Opening checkout…
                </>
              ) : (
                `Pay ${formatPesoClient(totalCents)}`
              )}
            </button>
            <button
              className="btn btn-ghost btn-block"
              style={{ padding: 8 }}
              disabled={submitting}
              onClick={() => setStep('slot')}
            >
              Change slot
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

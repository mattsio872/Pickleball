'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError, formatPesoClient } from '@/lib/client';

type Court = { id: string; code: string; name: string; blurb: string; meta: string; imageUrl: string; active: boolean; sortOrder: number };
type Closure = { id: string; courtCode: string | null; label: string; reason: string };
type SettingsShape = {
  venueName: string;
  city: string;
  timezone: string;
  hourlyRateCents: number;
  openHour: number;
  closeHour: number;
  durationsMinutes: number[];
  maxPlayers: number;
  holdMinutes: number;
  heroImageUrl: string;
  contactViber: string;
};

function Notice({ state }: { state: { kind: 'ok' | 'error'; message: string } | null }) {
  if (!state) return null;
  return (
    <div className={state.kind === 'ok' ? 'banner banner-ok' : 'banner banner-error'} style={{ marginBottom: 16 }}>
      {state.message}
    </div>
  );
}

export function SettingsPanel({ initial }: { initial: SettingsShape }) {
  const router = useRouter();
  const [form, setForm] = useState({
    ...initial,
    hourlyRatePesos: initial.hourlyRateCents / 100,
    durations: initial.durationsMinutes.map((m) => m / 60).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      // Entered in hours; stored in minutes. The venue sells whole hours only.
      const durationsMinutes = form.durations
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((hours) => Math.round(hours * 60));

      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          venueName: form.venueName,
          city: form.city,
          timezone: form.timezone,
          hourlyRateCents: Math.round(form.hourlyRatePesos * 100),
          openHour: Number(form.openHour),
          closeHour: Number(form.closeHour),
          durationsMinutes,
          maxPlayers: Number(form.maxPlayers),
          holdMinutes: Number(form.holdMinutes),
          heroImageUrl: form.heroImageUrl.trim(),
          contactViber: form.contactViber,
        }),
      });
      setNotice({ kind: 'ok', message: 'Saved. The public site now reflects these settings.' });
      router.refresh();
    } catch (e) {
      setNotice({ kind: 'error', message: e instanceof ApiRequestError ? e.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof typeof form,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="field">
      <label htmlFor={`s-${String(key)}`}>{label}</label>
      <input
        id={`s-${String(key)}`}
        className="input"
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <form onSubmit={save}>
      <Notice state={notice} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
        {field('venueName', 'Venue name')}
        {field('city', 'City')}
        {field('timezone', 'Timezone')}
        {field('hourlyRatePesos', 'Hourly rate (₱)', { type: 'number', min: 0, step: 10 })}
        {field('openHour', 'Opens (hour, 0–23)', { type: 'number', min: 0, max: 23 })}
        {field('closeHour', 'Closes (hour, 1–24)', { type: 'number', min: 1, max: 24 })}
        {field('durations', 'Block lengths in hours, comma-separated')}
        {field('maxPlayers', 'Players per court', { type: 'number', min: 1, max: 20 })}
        {field('holdMinutes', 'Hold window (minutes)', { type: 'number', min: 2, max: 120 })}
        {field('contactViber', 'Desk Viber number')}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="s-heroImageUrl">Hero image URL (optional)</label>
        <input
          id="s-heroImageUrl"
          className="input"
          value={form.heroImageUrl}
          placeholder="https://… — leave blank to show the generated artwork"
          onChange={(e) => setForm({ ...form, heroImageUrl: e.target.value })}
        />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 18, padding: '10px 18px' }} disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}

export function CourtsPanel({ initial }: { initial: Court[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [adding, setAdding] = useState({ code: '', name: '', blurb: '', meta: '', imageUrl: '' });
  const [busy, setBusy] = useState(false);

  async function send(path: string, method: string, body: unknown, okMessage: string) {
    setBusy(true);
    setNotice(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setNotice({ kind: 'ok', message: okMessage });
      router.refresh();
      return true;
    } catch (e) {
      setNotice({ kind: 'error', message: e instanceof ApiRequestError ? e.message : 'That did not work.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Notice state={notice} />

      <table className="table" style={{ marginBottom: 22 }}>
        <thead>
          <tr>
            <th>Court</th>
            <th>Name</th>
            <th>Photo</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {initial.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.code}</td>
              <td>{c.name}</td>
              <td style={{ minWidth: 220 }}>
                <input
                  className="input"
                  style={{ minHeight: 30, padding: '3px 8px', fontSize: 12 }}
                  defaultValue={c.imageUrl}
                  placeholder="https://… (blank = artwork)"
                  disabled={busy}
                  onBlur={(e) => {
                    if (e.target.value.trim() === c.imageUrl) return;
                    void send(
                      '/api/admin/courts',
                      'PATCH',
                      { id: c.id, imageUrl: e.target.value.trim() },
                      `Photo updated for Court ${c.code}.`,
                    );
                  }}
                />
              </td>
              <td>
                <span className={c.active ? 'tag tag-accent' : 'tag tag-neutral'}>{c.active ? 'Open' : 'Retired'}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      '/api/admin/courts',
                      'PATCH',
                      { id: c.id, active: !c.active },
                      `Court ${c.code} ${c.active ? 'retired' : 'reopened'}.`,
                    )
                  }
                >
                  {c.active ? 'Retire' : 'Reopen'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h5 style={{ marginBottom: 10 }}>Add a court</h5>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await send('/api/admin/courts', 'POST', adding, `Court ${adding.code.toUpperCase()} added.`);
          if (ok) setAdding({ code: '', name: '', blurb: '', meta: '', imageUrl: '' });
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="c-code">Code</label>
            <input
              id="c-code"
              className="input"
              maxLength={4}
              value={adding.code}
              onChange={(e) => setAdding({ ...adding, code: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="c-name">Name</label>
            <input
              id="c-name"
              className="input"
              value={adding.name}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="c-meta">Meta line</label>
            <input
              id="c-meta"
              className="input"
              placeholder="Indoor · 4m clearance"
              value={adding.meta}
              onChange={(e) => setAdding({ ...adding, meta: e.target.value })}
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="c-image">Photo URL (optional)</label>
          <input
            id="c-image"
            className="input"
            value={adding.imageUrl}
            placeholder="https://… — leave blank to show the generated artwork"
            onChange={(e) => setAdding({ ...adding, imageUrl: e.target.value })}
          />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="c-blurb">Description</label>
          <textarea
            id="c-blurb"
            className="input"
            style={{ minHeight: 70 }}
            value={adding.blurb}
            onChange={(e) => setAdding({ ...adding, blurb: e.target.value })}
          />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14, padding: '10px 18px' }} disabled={busy}>
          Add court
        </button>
      </form>
    </div>
  );
}

export function ClosuresPanel({ courts, closures }: { courts: Court[]; closures: Closure[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ courtId: '', date: '', start: '09:00', end: '12:00', reason: '' });

  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  return (
    <div>
      <Notice state={notice} />

      {closures.length > 0 ? (
        <table className="table" style={{ marginBottom: 22 }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Court</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{c.courtCode ? `Court ${c.courtCode}` : 'All courts'}</td>
                <td>{c.reason}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/api/admin/closures?id=${c.id}`, { method: 'DELETE' });
                        setNotice({ kind: 'ok', message: 'Closure removed; those slots are bookable again.' });
                        router.refresh();
                      } catch (e) {
                        setNotice({
                          kind: 'error',
                          message: e instanceof ApiRequestError ? e.message : 'Could not remove it.',
                        });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 22 }}>
          No closures scheduled. Every court follows the standard opening hours.
        </p>
      )}

      <h5 style={{ marginBottom: 10 }}>Close a court</h5>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice(null);
          try {
            await api('/api/admin/closures', {
              method: 'POST',
              body: JSON.stringify({
                courtId: form.courtId || null,
                date: form.date,
                startMinutes: toMinutes(form.start),
                endMinutes: toMinutes(form.end),
                reason: form.reason,
              }),
            });
            setNotice({ kind: 'ok', message: 'Closure added. Those slots are now off the booking page.' });
            setForm({ ...form, reason: '' });
            router.refresh();
          } catch (err) {
            setNotice({
              kind: 'error',
              message: err instanceof ApiRequestError ? err.message : 'Could not add the closure.',
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="cl-court">Court</label>
            <select
              id="cl-court"
              className="input"
              value={form.courtId}
              onChange={(e) => setForm({ ...form, courtId: e.target.value })}
            >
              <option value="">All courts</option>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  Court {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-date">Date</label>
            <input
              id="cl-date"
              className="input"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cl-start">From</label>
            <input
              id="cl-start"
              className="input"
              type="time"
              step={1800}
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cl-end">To</label>
            <input
              id="cl-end"
              className="input"
              type="time"
              step={1800}
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
              required
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="cl-reason">Reason (shown to staff only)</label>
          <input
            id="cl-reason"
            className="input"
            placeholder="Floor resurfacing"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14, padding: '10px 18px' }} disabled={busy}>
          Add closure
        </button>
      </form>
    </div>
  );
}

export { formatPesoClient };

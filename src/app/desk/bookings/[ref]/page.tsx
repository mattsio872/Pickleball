import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { findByRefWithParty } from '@/lib/booking';
import { formatPeso } from '@/lib/money';
import { methodLabel } from '@/lib/payments';
import { makePassToken, passUrl, qrImagePath, renderQrSvg } from '@/lib/pass';
import { dateLabel, dayKeyOf, slotLabel } from '@/lib/time';
import { StaffBar } from '@/components/StaffBar';

export const dynamic = 'force-dynamic';

/**
 * One booking, in full.
 *
 * The week grid could only hand a chip to the search box on the management
 * screen, which answers "which booking" and not "what is this booking" — so
 * anyone asked about a slot on the phone had to reconstruct it from a list.
 * Everything the desk gets asked is on this page: who, when, what was paid, who
 * is on the roster, and whether they have been in yet.
 */
export default async function BookingDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const session = await currentStaff();
  if (!session) redirect(`/desk/login?next=${encodeURIComponent(`/desk/bookings/${ref}`)}`);

  const booking = await findByRefWithParty(ref);
  if (!booking) notFound();

  const settings = await getSettings();
  const timezone = settings.timezone;
  const now = new Date();
  const paid = booking.payments.find((p) => p.status === 'PAID');
  const pending = booking.payments.filter((p) => p.status !== 'PAID');
  const hours = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 3_600_000);
  const finished = booking.endsAt < now;
  const admissible = booking.status === 'CONFIRMED' && !finished;
  const checkedIn = booking.players.filter((p) => p.checkedInAt).length;
  const qrSvg = admissible ? await renderQrSvg(passUrl(booking)) : null;

  const when = (value: Date | null | undefined) =>
    value ? `${dateLabel(dayKeyOf(value, timezone), timezone)}, ${value.toLocaleTimeString('en-PH', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}` : '—';

  const rows: [string, string][] = [
    ['Court', `Court ${booking.court.code} · ${booking.court.name}`],
    ['Slot', slotLabel(booking.startsAt, booking.endsAt, timezone)],
    ['Length', `${hours} ${hours === 1 ? 'hour' : 'hours'}`],
    ['Price', `${formatPeso(booking.totalCents)} · ${formatPeso(booking.hourlyRateCents)}/hour as booked`],
    ['Booker', booking.customerName],
    ['Mobile', booking.customerMobile],
    ['Email', booking.customerEmail],
    ['Account', booking.customerId ? 'Signed-in customer' : 'No account — booked at the desk or before accounts'],
    ['Booked', when(booking.createdAt)],
    ['Pass emailed', when(booking.passEmailedAt)],
    ['First scanned', when(booking.scannedAt)],
  ];
  if (booking.status === 'HELD') rows.push(['Hold expires', when(booking.holdExpiresAt)]);

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 900 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <Link className="btn btn-ghost" href="/admin/schedule">
            ← The week
          </Link>
          <Link className="btn btn-ghost" href="/desk/bookings">
            All bookings
          </Link>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          {booking.status === 'CONFIRMED' ? (
            <span className="tag tag-accent">Confirmed</span>
          ) : (
            <span className="tag tag-outline">{booking.status.toLowerCase()}</span>
          )}
          {paid ? (
            <span className="tag tag-accent-2">Paid{paid.method ? ` · ${methodLabel(paid.method)}` : ''}</span>
          ) : (
            <span className="tag tag-outline">Unpaid</span>
          )}
          {finished && <span className="tag tag-neutral">Finished</span>}
          {booking.scannedAt && <span className="tag tag-neutral">Scanned</span>}
        </div>

        <h2 className="mono" style={{ letterSpacing: '0.06em', marginBottom: 6 }}>
          {booking.ref}
        </h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 28 }}>
          {admissible
            ? 'Valid for entry. Scanning the pass or a player pass checks people in.'
            : booking.status === 'CONFIRMED'
              ? 'This slot has already finished.'
              : 'This booking does not admit anybody.'}
        </p>

        <div className="flow-grid">
          <div>
            <div className="stack" style={{ gap: 12, fontSize: 14, maxWidth: 460 }}>
              {rows.map(([label, value], i, all) => (
                <div
                  key={label}
                  className="summary-row"
                  style={i < all.length - 1 ? { paddingBottom: 11, borderBottom: '1px solid var(--color-divider)' } : undefined}
                >
                  <span>{label}</span>
                  <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
                </div>
              ))}
            </div>

            <h4 style={{ margin: '32px 0 10px' }}>
              Roster — {checkedIn} of {booking.players.length} checked in
            </h4>
            <div className="stack" style={{ gap: 8, maxWidth: 460 }}>
              {booking.players.map((player) => (
                <div key={player.id} className="roster-row" data-checked={Boolean(player.checkedInAt)}>
                  <span>
                    {player.name}
                    {player.isBooker ? ' (booker)' : ''}
                    {player.contact ? ` · ${player.contact}` : ''}
                  </span>
                  <span className={player.checkedInAt ? 'tag tag-accent' : 'tag tag-outline'}>
                    {player.checkedInAt ? 'Checked in' : 'Registered'}
                  </span>
                </div>
              ))}
            </div>

            <h4 style={{ margin: '32px 0 10px' }}>Payments</h4>
            {booking.payments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
                No payment has been started against this booking.
              </p>
            ) : (
              <div className="stack" style={{ gap: 8, maxWidth: 460, fontSize: 13.5 }}>
                {[...(paid ? [paid] : []), ...pending].map((payment) => (
                  <div key={payment.id} className="roster-row">
                    <span>
                      {formatPeso(payment.amountCents)}
                      {payment.method ? ` · ${methodLabel(payment.method)}` : ''}
                      <span className="muted"> · {payment.provider}</span>
                      {payment.paidAt ? <span className="muted"> · {when(payment.paidAt)}</span> : null}
                    </span>
                    <span className={payment.status === 'PAID' ? 'tag tag-accent' : 'tag tag-outline'}>
                      {payment.status.toLowerCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: 30 }}>
              <Link className="btn btn-primary" href={`/desk/bookings?q=${encodeURIComponent(booking.ref)}`}>
                Move, release or edit
              </Link>
              <Link className="btn btn-secondary" href="/desk">
                Check players in
              </Link>
            </div>
          </div>

          {qrSvg && (
            <aside className="pass-card">
              <div className="spread" style={{ width: '100%', marginBottom: 18 }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{settings.venueName}</span>
                <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-700)' }}>
                  Entry pass
                </span>
              </div>
              <div className="pass-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div className="pass-foot">
                <div className="mono" style={{ fontSize: 17, letterSpacing: '0.06em' }}>
                  {booking.ref}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
                  The party&rsquo;s own pass. Re-send it by saving the image and messaging it to the booker.
                </div>
              </div>
              <a className="btn btn-secondary btn-block" style={{ marginTop: 18 }} href={qrImagePath(makePassToken(booking))} download>
                Save QR as an image
              </a>
            </aside>
          )}
        </div>
      </main>
    </>
  );
}

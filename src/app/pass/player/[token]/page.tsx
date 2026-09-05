import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-auth';
import { makePlayerToken, playerPassUrl, qrImagePath, renderQrSvg, verifyPlayerToken } from '@/lib/pass';
import { dateLabel, dayKeyOf, minutesIntoDayOf, timeLabel } from '@/lib/time';
import { SiteHeader } from '@/components/SiteHeader';

export const dynamic = 'force-dynamic';

/**
 * One player's own copy of their pass.
 *
 * A party rarely arrives together, and until now only the booker could open a
 * door. This page carries a single player's QR and nothing that is not theirs
 * to see: no payment, no contact details, not even the rest of the roster.
 */
export default async function PlayerPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verification = await verifyPlayerToken(decodeURIComponent(token));
  if (!verification.valid) notFound();

  const { booking, player } = verification;
  const settings = await getSettings();
  const customer = await currentCustomer();
  const timezone = settings.timezone;
  const day = dateLabel(dayKeyOf(booking.startsAt, timezone), timezone);
  const time = `${timeLabel(minutesIntoDayOf(booking.startsAt, timezone))} – ${timeLabel(minutesIntoDayOf(booking.endsAt, timezone))}`;
  const courtLine = `Court ${booking.court.code} · ${booking.court.name}`;
  const confirmed = booking.status === 'CONFIRMED';
  const finished = booking.endsAt < new Date();
  const qrSvg = await renderQrSvg(playerPassUrl(booking, player));
  const download = qrImagePath(makePlayerToken(booking, player));

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} customerName={customer?.name} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 520 }}>
        {!confirmed && (
          <div className="banner banner-warn" style={{ marginBottom: 26 }}>
            <strong>This booking is not confirmed.</strong> Your pass will not admit you until it is.
          </div>
        )}
        {confirmed && finished && (
          <div className="banner banner-warn" style={{ marginBottom: 26 }}>
            This booking has already finished.
          </div>
        )}

        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Your pass
        </div>
        <h2 style={{ marginBottom: 8 }}>{player.name}</h2>
        <p className="muted" style={{ fontSize: 14, marginBottom: 26, maxWidth: '46ch' }}>
          Show this at the front desk. It checks you in on your own — you do not have to arrive with
          {booking.customerName === player.name ? ' your party' : ` ${booking.customerName.split(' ')[0]}`}.
        </p>

        <aside className="pass-card" style={confirmed && !finished ? undefined : { opacity: 0.55 }}>
          <div className="spread" style={{ width: '100%', marginBottom: 18 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{settings.venueName}</span>
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-neutral-700)',
              }}
            >
              Player pass
            </span>
          </div>
          <div className="pass-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="pass-foot">
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>{player.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
              {courtLine} · {day} · {time}
            </div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: player.checkedInAt ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
              }}
            >
              {player.checkedInAt ? 'Checked in' : `Ref ${booking.ref}`}
            </div>
          </div>
          <a className="btn btn-secondary btn-block" style={{ marginTop: 18 }} href={download} download>
            Save QR as an image
          </a>
        </aside>

        <div className="row" style={{ marginTop: 28, justifyContent: 'center' }}>
          <Link className="btn btn-ghost" href="/">
            Back to {settings.venueName}
          </Link>
        </div>
      </main>
    </>
  );
}

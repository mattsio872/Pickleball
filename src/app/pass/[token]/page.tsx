import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-auth';
import {
  verifyPassToken,
  renderQrSvg,
  passUrl,
  joinUrl,
  makePassToken,
  makePlayerToken,
  playerPassPageUrl,
  playerPassUrl,
  qrImagePath,
} from '@/lib/pass';
import { formatPeso } from '@/lib/money';
import { dateLabel, dayKeyOf, minutesIntoDayOf, timeLabel } from '@/lib/time';
import { methodLabel } from '@/lib/payments';
import { SiteHeader } from '@/components/SiteHeader';
import { CopyButton } from '@/components/CopyButton';

export const dynamic = 'force-dynamic';

/**
 * The booker's own copy of the pass.
 *
 * Reachable by anyone holding the signed token — that is the point, since it is
 * emailed and forwarded — but the token cannot be guessed or altered, and the
 * page shows the booking's live status rather than a snapshot from payment time.
 */
export default async function PassPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ just_paid?: string }>;
}) {
  const { token } = await params;
  const { just_paid: justPaid } = await searchParams;

  const verification = await verifyPassToken(decodeURIComponent(token));
  if (!verification.valid) notFound();

  const settings = await getSettings();
  const customer = await currentCustomer();
  const booking = await prisma.booking.findUnique({
    where: { id: verification.booking.id },
    include: {
      court: true,
      players: { orderBy: [{ isBooker: 'desc' }, { createdAt: 'asc' }] },
      payments: { where: { status: 'PAID' }, take: 1 },
    },
  });
  if (!booking) notFound();

  const timezone = settings.timezone;
  const day = dateLabel(dayKeyOf(booking.startsAt, timezone), timezone);
  const time = `${timeLabel(minutesIntoDayOf(booking.startsAt, timezone))} – ${timeLabel(minutesIntoDayOf(booking.endsAt, timezone))}`;
  const courtLine = `Court ${booking.court.code} · ${booking.court.name}`;
  const payment = booking.payments[0];
  const confirmed = booking.status === 'CONFIRMED';
  const qrSvg = await renderQrSvg(passUrl(booking));
  const join = joinUrl(booking);
  const qrDownload = qrImagePath(makePassToken(booking));

  // Each player carries their own QR so they can be admitted without waiting
  // for the booker to arrive with theirs.
  const playerPasses = confirmed
    ? await Promise.all(
        booking.players.map(async (player) => ({
          player,
          svg: await renderQrSvg(playerPassUrl(booking, player)),
          download: qrImagePath(makePlayerToken(booking, player)),
          page: playerPassPageUrl(booking, player),
        })),
      )
    : [];

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} customerName={customer?.name} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px' }}>
        {!confirmed && (
          <div className="banner banner-warn" style={{ marginBottom: 26 }}>
            {booking.status === 'HELD' ? (
              <>
                <strong>Payment not confirmed yet.</strong> If you have just paid, this page will show the confirmation
                as soon as the provider notifies us — usually within a few seconds. Refresh in a moment.
              </>
            ) : booking.status === 'CANCELLED' ? (
              <>
                <strong>This booking was cancelled.</strong> The pass below will not admit your party.
              </>
            ) : (
              <>
                <strong>This hold expired before payment cleared.</strong> The slot has been released. Please{' '}
                <Link href="/book">book again</Link>.
              </>
            )}
          </div>
        )}

        {confirmed && justPaid && (
          <div className="banner banner-ok" style={{ marginBottom: 26 }}>
            Payment received. A copy of this pass is on its way to <strong>{booking.customerEmail}</strong>.
          </div>
        )}

        <div className="flow-grid">
          <div>
            <div className="row" style={{ marginBottom: 16 }}>
              {confirmed ? (
                <span className="tag tag-accent">Paid{payment?.method ? ` · ${methodLabel(payment.method)}` : ''}</span>
              ) : (
                <span className="tag tag-outline">{booking.status.toLowerCase()}</span>
              )}
              <span className="tag tag-neutral">Ref {booking.ref}</span>
            </div>

            <h2 style={{ marginBottom: 8 }}>{confirmed ? "You're on the court." : 'Your booking'}</h2>
            <p style={{ fontSize: 15, color: 'var(--color-neutral-700)', maxWidth: '46ch', marginBottom: 26, textWrap: 'pretty' }}>
              Show the QR at the front desk — the staff scan verifies the booking, the court and that payment cleared.
            </p>

            <div className="stack" style={{ gap: 13, fontSize: 14, maxWidth: 420 }}>
              {[
                ['Court', courtLine],
                ['When', `${day}, ${time}`],
                [confirmed ? 'Paid' : 'Total', formatPeso(booking.totalCents)],
                ['Booker', booking.customerName],
              ].map(([label, value], i, all) => (
                <div
                  key={label}
                  className="summary-row"
                  style={
                    i < all.length - 1
                      ? { paddingBottom: 12, borderBottom: '1px solid var(--color-divider)' }
                      : undefined
                  }
                >
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>

            {confirmed && (
              <div style={{ marginTop: 34 }}>
                <h4 style={{ marginBottom: 6 }}>Your players check themselves in</h4>
                <p className="muted" style={{ fontSize: 13, marginBottom: 14, maxWidth: '46ch' }}>
                  Send this link to your group. Each player registers their own name on it and gets a QR of their own,
                  so anyone can be let in without waiting for you.
                </p>
                <div className="row" style={{ marginBottom: 18 }}>
                  <code
                    className="mono"
                    style={{
                      fontSize: 12.5,
                      background: 'var(--color-surface)',
                      boxShadow: 'var(--shadow-sm)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {join.replace(/^https?:\/\//, '')}
                  </code>
                  <CopyButton value={join} />
                </div>

                <div className="stack" style={{ gap: 10, maxWidth: 460 }}>
                  {playerPasses.map(({ player, svg, download, page }) => (
                    <div key={player.id} className="player-pass">
                      {/* The thumbnail is small to keep the roster a list; it
                          opens the player's own page, where the code is big
                          enough to scan off the screen. */}
                      <Link
                        className="player-pass-qr"
                        href={page.replace(/^https?:\/\/[^/]+/, '')}
                        aria-label={`Open ${player.name}'s pass`}
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />
                      <div className="player-pass-body">
                        <div className="spread" style={{ alignItems: 'center', gap: 8 }}>
                          <span style={{ color: player.isBooker ? 'var(--color-text)' : 'var(--color-neutral-700)' }}>
                            {player.name}
                            {player.isBooker ? ' (booker)' : ''}
                          </span>
                          <span className={player.checkedInAt ? 'tag tag-accent' : 'tag tag-outline'}>
                            {player.checkedInAt ? 'Checked in' : 'Registered'}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 8, marginTop: 8 }}>
                          <a className="btn btn-ghost btn-sm" href={download} download>
                            Save QR
                          </a>
                          <CopyButton value={page} className="btn btn-ghost btn-sm" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', maxWidth: '46ch' }}>
                    {booking.players.length === 1
                      ? 'Nobody else has signed up yet. Invite as many players as you like — there is no limit.'
                      : 'Each player has their own QR. Send it on, or copy their pass link — whoever arrives first can be let in on their own.'}
                  </p>
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 30 }}>
              <Link className="btn btn-secondary" href="/book">
                Book another slot
              </Link>
              <Link className="btn btn-ghost" href="/">
                Done
              </Link>
            </div>
          </div>

          <aside className="pass-card" style={confirmed ? undefined : { opacity: 0.55 }}>
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
                Entry pass
              </span>
            </div>
            <div className="pass-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="pass-foot">
              <div className="mono" style={{ fontSize: 17, letterSpacing: '0.06em' }}>
                {booking.ref}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
                {courtLine} · {day} · {time}
              </div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: confirmed ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
                }}
              >
                {confirmed ? `Payment verified · ${formatPeso(booking.totalCents)}` : 'Not yet valid for entry'}
              </div>
            </div>
            <a className="btn btn-secondary btn-block" style={{ marginTop: 18 }} href={qrDownload} download>
              Save QR as an image
            </a>
          </aside>
        </div>
      </main>
    </>
  );
}

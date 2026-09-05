import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { verifyScannedToken } from '@/lib/pass';
import { findByRefWithParty } from '@/lib/booking';
import { formatPeso } from '@/lib/money';
import { slotLabel } from '@/lib/time';
import { methodLabel } from '@/lib/payments';
import { StaffBar } from '@/components/StaffBar';
import { PlayerCheckIn } from './PlayerCheckIn';

export const dynamic = 'force-dynamic';

/**
 * Where a pass QR points.
 *
 * A phone camera opening the link lands here; without a staff session it
 * redirects to sign-in rather than revealing anything about the booking.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const session = await currentStaff();
  if (!session) {
    redirect(`/desk/login?next=${encodeURIComponent(`/desk/verify?t=${t ?? ''}`)}`);
  }

  const settings = await getSettings();
  const verification = t ? await verifyScannedToken(t) : null;
  const booking = verification?.valid ? await findByRefWithParty(verification.booking.ref) : null;
  const paid = booking?.payments.find((p) => p.status === 'PAID');
  const admit = booking?.status === 'CONFIRMED' && booking.endsAt > new Date();
  // A player's own pass names the one person to admit; a booking pass covers
  // the whole party and sends the desk to the roster.
  const scanned = verification?.valid && verification.kind === 'player' ? verification.player : null;
  const player = scanned ? (booking?.players.find((p) => p.id === scanned.id) ?? null) : null;

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 640 }}>
        <h2 style={{ marginBottom: 20 }}>{player ? 'Player pass check' : 'Pass check'}</h2>

        {!verification?.valid || !booking ? (
          <div style={{ borderRadius: 14, padding: 26, background: 'var(--color-accent-100)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="tag tag-outline" style={{ marginBottom: 12 }}>
              Do not admit
            </div>
            <h4 style={{ marginBottom: 6 }}>
              {!t
                ? 'No pass supplied.'
                : verification && !verification.valid && verification.reason === 'bad_signature'
                  ? 'This pass has been altered or was not issued by us.'
                  : verification && !verification.valid && verification.kind === 'player' && verification.reason === 'unknown'
                  ? 'That player is no longer on this booking\u2019s roster.'
                  : 'No booking matches this pass.'}
            </h4>
            <p style={{ fontSize: 13.5, color: 'var(--color-neutral-700)', margin: 0 }}>
              Use the <Link href="/desk">scanner</Link> to try again, or look the booking up by reference.
            </p>
          </div>
        ) : (
          <div style={{ borderRadius: 14, padding: 26, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)' }}>
            <div className="row" style={{ marginBottom: 16 }}>
              {admit ? (
                <span className="tag tag-accent">Booking verified</span>
              ) : (
                <span className="tag tag-outline">Do not admit — {booking.status.toLowerCase()}</span>
              )}
              {paid ? (
                <span className="tag tag-accent-2">Paid{paid.method ? ` · ${methodLabel(paid.method)}` : ''}</span>
              ) : (
                <span className="tag tag-outline">Unpaid</span>
              )}
            </div>
            {player ? (
              <>
                <h3 style={{ margin: '0 0 4px' }}>{player.name}</h3>
                <div className="mono" style={{ fontSize: 13, letterSpacing: '0.06em', marginBottom: 18, color: 'var(--color-neutral-700)' }}>
                  {booking.ref} · {player.isBooker ? 'booker' : 'player'}
                  {player.checkedInAt ? ' · already checked in' : ''}
                </div>
              </>
            ) : (
              <div className="mono" style={{ fontSize: 22, letterSpacing: '0.06em', marginBottom: 18 }}>
                {booking.ref}
              </div>
            )}
            <div className="stack" style={{ gap: 12, fontSize: 14 }}>
              {[
                ['Court', `Court ${booking.court.code} · ${booking.court.name}`],
                ['Slot', slotLabel(booking.startsAt, booking.endsAt, settings.timezone)],
                ['Amount paid', formatPeso(booking.totalCents)],
                ['Booker', `${booking.customerName} · ${booking.customerMobile}`],
                ['Party', `${booking.players.length} registered`],
              ].map(([label, value], i, all) => (
                <div
                  key={label}
                  className="summary-row"
                  style={i < all.length - 1 ? { paddingBottom: 11, borderBottom: '1px solid var(--color-divider)' } : undefined}
                >
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
            {player ? (
              <>
                <PlayerCheckIn
                  playerId={player.id}
                  playerName={player.name}
                  checkedIn={Boolean(player.checkedInAt)}
                  disabled={!admit}
                />
                <Link className="btn btn-ghost btn-block" style={{ padding: 9 }} href="/desk">
                  Open the whole roster
                </Link>
              </>
            ) : (
              <Link className="btn btn-primary btn-block" style={{ padding: 11, marginTop: 20 }} href="/desk">
                Open the roster to check players in
              </Link>
            )}
          </div>
        )}
      </main>
    </>
  );
}

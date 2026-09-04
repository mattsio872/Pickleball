import { notFound } from 'next/navigation';
import { findByRefWithParty } from '@/lib/booking';
import { getSettings } from '@/lib/settings';
import { dateLabel, dayKeyOf, minutesIntoDayOf, timeLabel } from '@/lib/time';
import { SiteHeader } from '@/components/SiteHeader';
import { JoinForm } from './JoinForm';

export const dynamic = 'force-dynamic';

/**
 * Where a player lands from the booker's join link.
 *
 * Only the roster is exposed here — no payment details, no contact details for
 * the other players, and no way to reach the pass itself.
 */
export default async function JoinPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const booking = await findByRefWithParty(ref);
  if (!booking) notFound();

  const settings = await getSettings();
  const timezone = settings.timezone;
  const day = dateLabel(dayKeyOf(booking.startsAt, timezone), timezone);
  const time = `${timeLabel(minutesIntoDayOf(booking.startsAt, timezone))} – ${timeLabel(minutesIntoDayOf(booking.endsAt, timezone))}`;
  const finished = booking.endsAt < new Date();
  const open = booking.status === 'CONFIRMED' && !finished;

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          Join a booking
        </div>
        <h2 style={{ marginBottom: 8 }}>
          {booking.customerName.split(' ')[0]} booked a court. Add your name.
        </h2>
        <p className="muted" style={{ fontSize: 14, marginBottom: 26, maxWidth: '52ch' }}>
          Registering here puts you on the desk&rsquo;s roster, so you can be checked in when the booker&rsquo;s pass is
          scanned. No payment is needed — the court is already paid for.
        </p>

        <div className="stack" style={{ gap: 12, fontSize: 14, maxWidth: 420, marginBottom: 30 }}>
          {[
            ['Court', `Court ${booking.court.code} · ${booking.court.name}`],
            ['When', `${day}, ${time}`],
            ['Party', `${booking.players.length} of ${settings.maxPlayers} registered`],
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

        {!open ? (
          <div className="banner banner-warn">
            {finished
              ? 'That booking has already finished.'
              : 'That booking is not confirmed, so its roster is closed.'}
          </div>
        ) : (
          <>
            <div className="stack" style={{ gap: 8, maxWidth: 420, marginBottom: 26 }}>
              {booking.players.map((p) => (
                <div key={p.id} className="roster-row">
                  <span>
                    {p.name}
                    {p.isBooker ? ' (booker)' : ''}
                  </span>
                  <span className="tag tag-neutral">Registered</span>
                </div>
              ))}
            </div>
            <JoinForm bookingRef={booking.ref} full={booking.players.length >= settings.maxPlayers} />
          </>
        )}
      </main>
    </>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { currentCustomer, customerBookings } from '@/lib/customer-auth';
import { getSettings } from '@/lib/settings';
import { formatPeso } from '@/lib/money';
import { slotLabel } from '@/lib/time';
import { makePassToken, qrImagePath } from '@/lib/pass';
import { methodLabel } from '@/lib/payments';
import { SiteHeader } from '@/components/SiteHeader';
import { ClaimBooking, ProfilePanel, CustomerSignOut } from './MyAccountPanels';

export const dynamic = 'force-dynamic';

export default async function MyBookingsPage() {
  const session = await currentCustomer();
  if (!session) redirect('/signin?next=/my');

  const [settings, customer, bookings] = await Promise.all([
    getSettings(),
    prisma.customer.findUniqueOrThrow({
      where: { id: session.customerId },
      select: { name: true, email: true, mobile: true },
    }),
    customerBookings(session.customerId),
  ]);

  const now = new Date();
  const upcoming = bookings.filter((b) => b.endsAt > now);
  const past = bookings.filter((b) => b.endsAt <= now);

  const card = (booking: (typeof bookings)[number], isPast: boolean) => {
    const paid = booking.payments[0];
    return (
      <div
        key={booking.id}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 12,
          padding: 18,
          boxShadow: 'var(--shadow-sm)',
          opacity: isPast ? 0.72 : 1,
        }}
      >
        <div className="row" style={{ marginBottom: 12 }}>
          {booking.status === 'CONFIRMED' ? (
            <span className="tag tag-accent">Paid{paid?.method ? ` · ${methodLabel(paid.method)}` : ''}</span>
          ) : (
            <span className="tag tag-outline">Awaiting payment</span>
          )}
          <span className="tag tag-neutral mono">{booking.ref}</span>
          {!isPast && booking.status === 'CONFIRMED' && (
            <>
              <Link className="btn btn-ghost" style={{ marginLeft: 'auto' }} href={`/pass/${encodeURIComponent(makePassToken(booking))}`}>
                Open pass
              </Link>
              <a className="btn btn-ghost" href={qrImagePath(makePassToken(booking))} download>
                Save QR
              </a>
            </>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 17, marginBottom: 4 }}>
          Court {booking.court.code} · {booking.court.name}
        </div>
        <div className="muted" style={{ fontSize: 13.5 }}>
          {slotLabel(booking.startsAt, booking.endsAt, settings.timezone)}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {formatPeso(booking.totalCents)} · {booking.players.length}{' '}
          {booking.players.length === 1 ? 'player' : 'players'} registered
        </div>
      </div>
    );
  };

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} customerName={customer.name} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 820 }}>
        <div className="row" style={{ alignItems: 'baseline', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Your bookings</h2>
          <span className="muted" style={{ fontSize: 13.5, marginLeft: 'auto' }}>
            {customer.email}
          </span>
          <CustomerSignOut />
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 30 }}>
          Hello {customer.name.split(' ')[0]}. Everything you have booked, and the details we fill in for you.
        </p>

        <h4 style={{ marginBottom: 12 }}>Coming up</h4>
        {upcoming.length === 0 ? (
          <div style={{ borderRadius: 12, padding: 22, boxShadow: 'var(--shadow-sm)', marginBottom: 34 }}>
            <p className="muted" style={{ fontSize: 14, margin: '0 0 14px' }}>
              Nothing booked yet.
            </p>
            <Link className="btn btn-primary" href="/book">
              Book a court
            </Link>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12, marginBottom: 34 }}>{upcoming.map((b) => card(b, false))}</div>
        )}

        {past.length > 0 && (
          <>
            <h4 style={{ marginBottom: 12 }}>Past</h4>
            <div className="stack" style={{ gap: 12, marginBottom: 34 }}>{past.map((b) => card(b, true))}</div>
          </>
        )}

        <section style={{ marginBottom: 34 }}>
          <h4 style={{ marginBottom: 4 }}>Add an earlier booking</h4>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Booked as a guest before signing up? Add it here.
          </p>
          <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
            <ClaimBooking />
          </div>
        </section>

        <section>
          <h4 style={{ marginBottom: 4 }}>Your details</h4>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Filled in automatically when you book.
          </p>
          <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
            <ProfilePanel initial={customer} />
          </div>
        </section>
      </main>
    </>
  );
}

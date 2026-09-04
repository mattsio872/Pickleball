import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSettings, toPublicSettings } from '@/lib/settings';
import { formatPeso } from '@/lib/money';
import { slotLabel } from '@/lib/time';
import { methodLabel } from '@/lib/payments';
import { paymentsLive, emailLive } from '@/lib/env';
import { StaffBar } from '@/components/StaffBar';
import { SettingsPanel, CourtsPanel, ClosuresPanel } from './AdminPanels';
import { StaffPanel } from './StaffPanel';
import { CustomersPanel } from './CustomersPanel';
import { listCustomers } from '@/lib/customers';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await currentStaff();
  if (!session) redirect('/desk/login?next=/admin');
  if (session.role !== 'ADMIN') {
    return (
      <>
        <StaffBar venueName="Pickle Lounge" staffName={session.name} role={session.role} />
        <main className="container" style={{ padding: '48px 24px' }}>
          <div className="banner banner-warn">
            The admin area is limited to venue admins. You&rsquo;re signed in as staff — the{' '}
            <Link href="/desk">front desk</Link> is where you want to be.
          </div>
        </main>
      </>
    );
  }

  const settings = await getSettings();
  const now = new Date();
  const startOfToday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [courts, upcoming, recent, closureRows, revenue, confirmedCount, staffRows, customerList] = await Promise.all([
    prisma.court.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    prisma.booking.findMany({
      where: { status: 'CONFIRMED', endsAt: { gt: now } },
      include: { court: true, players: true },
      orderBy: { startsAt: 'asc' },
      take: 25,
    }),
    prisma.booking.findMany({
      where: { createdAt: { gt: startOfToday } },
      include: { court: true, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.closure.findMany({ where: { endsAt: { gt: now } }, include: { court: true }, orderBy: { startsAt: 'asc' } }),
    prisma.booking.aggregate({ where: { status: 'CONFIRMED' }, _sum: { totalCents: true } }),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.staffUser.findMany({
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true, createdAt: true },
    }),
    listCustomers({ limit: 200 }),
  ]);

  const staff = staffRows.map((s) => ({
    ...s,
    lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));

  const closures = closureRows.map((c) => ({
    id: c.id,
    courtCode: c.court?.code ?? null,
    label: slotLabel(c.startsAt, c.endsAt, settings.timezone),
    reason: c.reason,
  }));

  const courtsPlain = courts.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    blurb: c.blurb,
    meta: c.meta,
    imageUrl: c.imageUrl,
    active: c.active,
    sortOrder: c.sortOrder,
  }));

  const section = (title: string, note: string, body: React.ReactNode) => (
    <section style={{ marginBottom: 44 }}>
      <h4 style={{ marginBottom: 4 }}>{title}</h4>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {note}
      </p>
      <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 22, boxShadow: 'var(--shadow-sm)' }}>
        {body}
      </div>
    </section>
  );

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px' }}>
        <h2 style={{ marginBottom: 6 }}>Admin</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 20 }}>
          Everything here takes effect on the public site immediately.
        </p>

        <Link className="btn btn-secondary" style={{ marginBottom: 28 }} href="/admin/schedule">
          Open the weekly schedule
        </Link>

        {(!paymentsLive() || !emailLive()) && (
          <div className="banner banner-warn" style={{ marginBottom: 28 }}>
            <strong>Not fully live yet.</strong>{' '}
            {!paymentsLive() && 'Payments are running on the built-in sandbox — no money moves until PAYMONGO_SECRET_KEY is set. '}
            {!emailLive() && 'Passes are being logged to the server console instead of emailed until RESEND_API_KEY is set.'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 40 }}>
          {[
            ['Confirmed bookings', String(confirmedCount)],
            ['Revenue booked', formatPeso(revenue._sum.totalCents ?? 0)],
            ['Upcoming', String(upcoming.length)],
            ['Courts open', String(courts.filter((c) => c.active).length)],
          ].map(([label, value]) => (
            <div key={label} className="card elev-sm">
              <div className="card-kicker">{label}</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28 }}>{value}</div>
            </div>
          ))}
        </div>

        {section(
          'Upcoming bookings',
          'Confirmed and still ahead of us.',
          upcoming.length === 0 ? (
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              Nothing booked yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Court</th>
                    <th>Slot</th>
                    <th>Booker</th>
                    <th>Party</th>
                    <th style={{ textAlign: 'right' }}>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{b.ref}</td>
                      <td>{b.court.code}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{slotLabel(b.startsAt, b.endsAt, settings.timezone)}</td>
                      <td>{b.customerName}</td>
                      <td>
                        {b.players.length}/{settings.maxPlayers}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatPeso(b.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        )}

        {section(
          'Last 24 hours',
          'Every booking attempt, whatever became of it — useful when a customer says their payment vanished.',
          recent.length === 0 ? (
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              No activity in the last day.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Status</th>
                    <th>Court</th>
                    <th>Slot</th>
                    <th>Payment</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((b) => {
                    const paid = b.payments.find((p) => p.status === 'PAID');
                    return (
                      <tr key={b.id}>
                        <td className="mono">{b.ref}</td>
                        <td>
                          <span className={b.status === 'CONFIRMED' ? 'tag tag-accent' : 'tag tag-neutral'}>
                            {b.status.toLowerCase()}
                          </span>
                        </td>
                        <td>{b.court.code}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{slotLabel(b.startsAt, b.endsAt, settings.timezone)}</td>
                        <td>{paid ? methodLabel(paid.method ?? '') : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{formatPeso(b.totalCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ),
        )}

        {section('Venue settings', 'Rate, opening hours and booking rules.', (
          <SettingsPanel initial={toPublicSettings(settings)} />
        ))}

        {section('Courts', 'Photos show on the site as soon as you paste a URL; leave one blank for the generated artwork. Retiring a court hides it from booking; existing bookings are protected.', (
          <CourtsPanel initial={courtsPlain} />
        ))}

        {section('Closures', 'Maintenance windows and holidays. Slots inside a closure stop being offered.', (
          <ClosuresPanel courts={courtsPlain} closures={closures} />
        ))}

        {section(
          'Staff accounts',
          'Who can reach the front desk and this dashboard. Everyone can change their own password under Your account.',
          <StaffPanel initial={staff} currentUserId={session.userId} />,
        )}

        {section(
          'Customers',
          'Everyone who has booked, grouped by the email they booked with. Read-only — customers do not have logins.',
          <CustomersPanel initial={customerList.customers} initialTotal={customerList.total} />,
        )}
      </main>
    </>
  );
}

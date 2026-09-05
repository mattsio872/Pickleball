import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { getWeekSchedule } from '@/lib/schedule';
import { formatPeso } from '@/lib/money';
import { dateLabel } from '@/lib/time';
import { StaffBar } from '@/components/StaffBar';

export const dynamic = 'force-dynamic';

/**
 * The week at a glance: every hour of every day, for every court.
 *
 * One cell per court per hour rather than one per hour, because "is Court B
 * free at 7 on Thursday" is the question the desk is actually asked, and an
 * aggregate count cannot answer it.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await currentStaff();
  if (!session) redirect('/desk/login?next=/admin/schedule');

  const { week } = await searchParams;
  const [settings, schedule] = await Promise.all([getSettings(), getWeekSchedule({ weekOf: week })]);

  const courtColour = (index: number) =>
    ['var(--color-accent-200)', 'var(--color-accent-2-200)', 'var(--color-neutral-200)'][index % 3];
  const courtInk = (index: number) =>
    ['var(--color-accent-800)', 'var(--color-accent-2-800)', 'var(--color-neutral-800)'][index % 3];

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px' }}>
        <div className="row" style={{ alignItems: 'baseline', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>The week</h2>
          {session.role === 'ADMIN' && (
            <Link className="btn btn-ghost" href="/admin">
              Admin dashboard
            </Link>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 22 }}>
          {dateLabel(schedule.weekStart, schedule.timezone)} – {dateLabel(schedule.weekEnd, schedule.timezone)}.
          Every court, every hour. Held-but-unpaid slots are outlined.
        </p>

        <div className="row" style={{ marginBottom: 20 }}>
          <Link className="btn btn-secondary" href={`/admin/schedule?week=${schedule.previousWeek}`}>
            ← Previous
          </Link>
          <Link className="btn btn-secondary" href="/admin/schedule">
            This week
          </Link>
          <Link className="btn btn-secondary" href={`/admin/schedule?week=${schedule.nextWeek}`}>
            Next →
          </Link>

          <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>
            {schedule.totals.bookings} bookings · {schedule.totals.hoursBooked} court-hours ·{' '}
            {formatPeso(schedule.totals.revenueCents)}
          </span>
        </div>

        <div className="row" style={{ gap: 14, marginBottom: 14, fontSize: 12 }}>
          {schedule.courts.map((court, i) => (
            <span key={court.id} className="row" style={{ gap: 6 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: courtColour(i),
                  display: 'inline-block',
                }}
              />
              Court {court.code} · {court.name}
            </span>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="schedule-grid">
            <thead>
              <tr>
                <th style={{ minWidth: 62 }} />
                {schedule.days.map((day) => (
                  <th key={day.dayKey} data-today={day.isToday}>
                    <div style={{ fontSize: 11, letterSpacing: '0.06em', opacity: 0.7 }}>
                      {day.weekday.toUpperCase()}
                    </div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>{day.dayOfMonth}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.hours.map((hour, rowIndex) => (
                <tr key={hour}>
                  <th scope="row">{schedule.days[0].cells[rowIndex].label.replace(':00', '')}</th>
                  {schedule.days.map((day) => {
                    const cell = day.cells[rowIndex];
                    return (
                      <td key={day.dayKey} data-closed={cell.closed} data-today={day.isToday}>
                        {cell.closed && <span className="schedule-closed">closed</span>}
                        {cell.bookings.map((booking) => {
                          const index = schedule.courts.findIndex((c) => c.id === booking.courtId);
                          return (
                            <Link
                              key={booking.ref}
                              href={`/desk/bookings?q=${encodeURIComponent(booking.ref)}`}
                              className="schedule-chip"
                              data-held={booking.status === 'HELD'}
                              style={{
                                background: booking.status === 'HELD' ? 'transparent' : courtColour(index),
                                borderColor: courtColour(index),
                                color: courtInk(index),
                              }}
                              title={`${booking.ref} · Court ${booking.courtCode} · ${booking.customerName} · ${booking.hours}h · ${booking.players} player${booking.players === 1 ? '' : 's'}${booking.status === 'HELD' ? ' · unpaid hold' : ''}`}
                            >
                              {booking.courtCode}
                              {booking.isStart && (
                                <span className="schedule-who"> {booking.customerName.split(' ')[0]}</span>
                              )}
                            </Link>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
          Hover a chip for the reference, booker and party size; click one to open the booking. A booking longer than
          an hour appears on every hour it occupies, named on the first.
        </p>
      </main>
    </>
  );
}

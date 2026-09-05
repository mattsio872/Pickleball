import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { StaffBar } from '@/components/StaffBar';
import { BookingsManager } from './BookingsManager';

export const dynamic = 'force-dynamic';

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await currentStaff();
  if (!session) redirect('/desk/login?next=/desk/bookings');

  const settings = await getSettings();

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 900 }}>
        <h2 style={{ marginBottom: 6 }}>Bookings</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 26, maxWidth: '62ch' }}>
          Move a booking to another court or time, release the court when a party cannot come, or correct the booker&rsquo;s
          details. Releasing keeps the record and puts the slot back on sale;{' '}
          {session.role === 'ADMIN'
            ? 'deleting removes the row entirely and is limited to admins.'
            : 'deleting a booking outright is limited to admins.'}
        </p>

        <BookingsManager isAdmin={session.role === 'ADMIN'} initialSearch={q ?? ''} />
      </main>
    </>
  );
}

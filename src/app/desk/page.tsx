import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { StaffBar } from '@/components/StaffBar';
import { DeskScanner } from './DeskScanner';

export const dynamic = 'force-dynamic';

export default async function DeskPage() {
  const session = await currentStaff();
  if (!session) redirect('/desk/login?next=/desk');

  const settings = await getSettings();

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px' }}>
        <div className="row" style={{ alignItems: 'baseline', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Front desk</h2>
          <span className="tag tag-neutral">
            Staff view · {settings.venueName} {settings.city}
          </span>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--color-neutral-700)', marginBottom: 26, maxWidth: '58ch' }}>
          Scan the arriving player&rsquo;s QR pass. The scan reads the booking reference off the pass and checks its
          signature; the court, slot and payment status are read from the booking system, not from the pass itself.
        </p>

        <DeskScanner />
      </main>
    </>
  );
}

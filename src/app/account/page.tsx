import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { StaffBar } from '@/components/StaffBar';
import { ChangePassword } from './ChangePassword';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await currentStaff();
  if (!session) redirect('/desk/login?next=/account');

  const settings = await getSettings();

  return (
    <>
      <StaffBar venueName={settings.venueName} staffName={session.name} role={session.role} />

      <main className="container fade-in" style={{ padding: '32px 24px 64px', maxWidth: 720 }}>
        <h2 style={{ marginBottom: 6 }}>Your account</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 28 }}>
          Signed in as {session.email} ({session.role === 'ADMIN' ? 'admin' : 'front desk'}).
        </p>

        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 22, boxShadow: 'var(--shadow-sm)' }}>
          <h4 style={{ marginBottom: 4 }}>Change your password</h4>
          <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
            Your current password is required, so an unattended signed-in browser cannot be used to take the account
            over.
          </p>
          <ChangePassword />
        </div>

        {session.role === 'ADMIN' && (
          <p className="muted" style={{ fontSize: 13, marginTop: 24 }}>
            To add or remove staff, or reset somebody else&rsquo;s password, go to <Link href="/admin">Admin</Link>.
          </p>
        )}
      </main>
    </>
  );
}

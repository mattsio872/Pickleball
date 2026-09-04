import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentStaff();
  const { next } = await searchParams;
  // Only same-site paths, so `next` cannot be used to bounce staff off-site.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/desk';
  if (session) redirect(target);

  const settings = await getSettings();

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: 'min(380px, 100%)' }}>
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Staff access
          </div>
          <h3 style={{ margin: 0 }}>{settings.venueName}</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            The front desk and admin screens are limited to venue staff.
          </p>
        </div>
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-md)' }}>
          <LoginForm next={target} />
        </div>
      </div>
    </main>
  );
}

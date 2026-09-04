import { redirect } from 'next/navigation';
import { currentCustomer, safeNext } from '@/lib/customer-auth';
import { getSettings } from '@/lib/settings';
import { SiteHeader } from '@/components/SiteHeader';
import { CustomerAuthForm } from './CustomerAuthForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);
  if (await currentCustomer()) redirect(target);

  const settings = await getSettings();

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} />
      <main className="container fade-in" style={{ padding: '48px 24px 64px', maxWidth: 420 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Your bookings
        </div>
        <h2 style={{ marginBottom: 6 }}>Sign in</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 24 }}>
          See everything you have booked, and have your details filled in next time.
        </p>
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-md)' }}>
          <CustomerAuthForm mode="signin" next={target} />
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 18, textAlign: 'center' }}>
          You do not need an account to book a court.
        </p>
      </main>
    </>
  );
}

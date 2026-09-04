import { redirect } from 'next/navigation';
import { currentCustomer, safeNext } from '@/lib/customer-auth';
import { getSettings } from '@/lib/settings';
import { SiteHeader } from '@/components/SiteHeader';
import { CustomerAuthForm } from '../signin/CustomerAuthForm';

export const dynamic = 'force-dynamic';

export default async function RegisterPage({
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
        <h2 style={{ marginBottom: 6 }}>Create an account</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 24 }}>
          Keep your bookings in one place and skip re-typing your details every time.
        </p>
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-md)' }}>
          <CustomerAuthForm mode="register" next={target} />
        </div>
      </main>
    </>
  );
}

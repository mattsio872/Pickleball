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
  const bookingFirst = target.startsWith('/book');

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
          {bookingFirst
            ? 'Courts are booked to an account, so your pass and your booking history stay in one place. Signing in takes you straight back to it.'
            : 'See everything you have booked, and have your details filled in next time.'}
        </p>
        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-md)' }}>
          <CustomerAuthForm mode="signin" next={target} />
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 18, textAlign: 'center', lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>Booked before you had an account? Sign in, then add it with its reference.</p>
          {/* There is no self-service reset — email delivery is not something
              this site can assume — so the way out is stated rather than left
              to be discovered. */}
          <p style={{ margin: '8px 0 0' }}>
            Forgotten your password? Message the desk on Viber at {settings.contactViber}. Your pass link and QR keep
            working either way.
          </p>
        </div>
      </main>
    </>
  );
}

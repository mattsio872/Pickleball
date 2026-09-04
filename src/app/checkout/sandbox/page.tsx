import { notFound } from 'next/navigation';
import { paymentsLive } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { methodLabel } from '@/lib/payments';
import { formatPeso } from '@/lib/money';
import { SandboxCheckout } from './SandboxCheckout';

export const dynamic = 'force-dynamic';

/**
 * The local stand-in for PayMongo's hosted checkout. Unreachable once real
 * credentials are configured — there is no route to it that could be used to
 * confirm a booking without paying.
 */
export default async function SandboxCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (paymentsLive()) notFound();

  const params = await searchParams;
  const { session, ref, booking, amount, method, success, cancel } = params;

  if (!session || !ref || !booking || !amount || !method || !success || !cancel) notFound();

  const settings = await getSettings();
  const amountCents = Number(amount);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: 'min(430px, 100%)' }}>
        <div className="banner banner-warn" style={{ marginBottom: 20 }}>
          <strong>Sandbox gateway.</strong> No payment provider is configured, so this page stands in for one. Nothing
          is charged and no money moves. Set <code>PAYMONGO_SECRET_KEY</code> to use the real checkout.
        </div>

        <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: 26, boxShadow: 'var(--shadow-md)' }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            {settings.venueName} · checkout
          </div>
          <div className="stack" style={{ gap: 11, marginBottom: 18 }}>
            <div className="summary-row">
              <span>Reference</span>
              <span className="mono">{ref}</span>
            </div>
            <div className="summary-row">
              <span>Method</span>
              <span>{methodLabel(method)}</span>
            </div>
            <div className="summary-row">
              <span>Session</span>
              <span className="mono" style={{ fontSize: 11 }}>
                {session.slice(0, 22)}…
              </span>
            </div>
          </div>
          <hr className="hr" style={{ margin: '4px 0 18px' }} />
          <div className="spread" style={{ marginBottom: 18 }}>
            <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Amount</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28 }}>{formatPeso(amountCents)}</span>
          </div>

          <SandboxCheckout
            bookingId={booking}
            bookingRef={ref}
            checkoutSessionId={session}
            amountCents={amountCents}
            method={method}
            successUrl={success}
            cancelUrl={cancel}
          />
        </div>
      </div>
    </main>
  );
}

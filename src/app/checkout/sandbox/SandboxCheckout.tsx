'use client';

import { useState } from 'react';
import { api, ApiRequestError, formatPesoClient } from '@/lib/client';

/**
 * Stands in for the payment provider's hosted page when no credentials are
 * configured. Choosing an outcome here posts a signed webhook through the real
 * endpoint, so the confirmation path is identical to production.
 */
export function SandboxCheckout(props: {
  bookingId: string;
  bookingRef: string;
  checkoutSessionId: string;
  amountCents: number;
  method: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const [busy, setBusy] = useState<'paid' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function settle(outcome: 'paid' | 'failed') {
    setBusy(outcome);
    setError(null);
    try {
      await api('/api/sandbox/pay', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: props.bookingId,
          bookingRef: props.bookingRef,
          checkoutSessionId: props.checkoutSessionId,
          amountCents: props.amountCents,
          method: props.method,
          outcome,
        }),
      });
      window.location.href = outcome === 'paid' ? props.successUrl : props.cancelUrl;
    } catch (e) {
      setBusy(null);
      setError(e instanceof ApiRequestError ? e.message : 'The sandbox gateway failed.');
    }
  }

  return (
    <>
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      <button
        className="btn btn-primary btn-block"
        style={{ padding: 12 }}
        disabled={busy !== null}
        onClick={() => void settle('paid')}
      >
        {busy === 'paid' ? (
          <>
            <span className="spinner" /> Confirming…
          </>
        ) : (
          `Approve ${formatPesoClient(props.amountCents)}`
        )}
      </button>
      <button
        className="btn btn-secondary btn-block"
        style={{ padding: 10 }}
        disabled={busy !== null}
        onClick={() => void settle('failed')}
      >
        {busy === 'failed' ? 'Declining…' : 'Decline the payment'}
      </button>
      <a className="btn btn-ghost btn-block" style={{ padding: 8 }} href={props.cancelUrl}>
        Cancel and go back
      </a>
    </>
  );
}

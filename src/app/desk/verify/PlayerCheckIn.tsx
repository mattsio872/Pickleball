'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

/**
 * Admit the one player whose pass was scanned.
 *
 * The roster on /desk is still where a whole party is worked through; this is
 * the single tap for the common case — one player, one QR, at the door.
 */
export function PlayerCheckIn({
  playerId,
  playerName,
  checkedIn,
  disabled,
}: {
  playerId: string;
  playerName: string;
  checkedIn: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(checkedIn);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ checkedIn: boolean }>('/api/desk/checkin', {
        method: 'POST',
        body: JSON.stringify({ playerId, checkedIn: !state }),
      });
      setState(result.checkedIn);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not update the roster.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="banner banner-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
      <button
        type="button"
        className={state ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block'}
        style={{ padding: 11, marginTop: 20 }}
        onClick={toggle}
        disabled={busy || disabled}
      >
        {busy ? (
          <>
            <span className="spinner" /> Saving…
          </>
        ) : state ? (
          `${playerName.split(' ')[0]} is checked in — undo`
        ) : (
          `Check ${playerName.split(' ')[0]} in`
        )}
      </button>
    </>
  );
}

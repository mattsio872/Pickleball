'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { api, ApiRequestError } from '@/lib/client';

/**
 * The front desk scanner.
 *
 * The mockup had a "Simulate a scan" button; this reads the camera. A frame is
 * grabbed a few times a second and decoded locally — the video never leaves the
 * device — and only the decoded token is sent to the server for verification.
 *
 * Cameras are not always available (a desktop with no webcam, a denied
 * permission, or a browser that requires HTTPS), so the reference field beneath
 * is a first-class path rather than a fallback: the desk can always work.
 */

type Player = { id: string; name: string; isBooker: boolean; checkedIn: boolean };

type VerifyResult =
  | { outcome: 'invalid' | 'not_found'; reason: string; ref?: string }
  | {
      outcome: 'admit' | 'expired' | 'refuse';
      ref: string;
      status: string;
      court: string;
      slot: string;
      total: string;
      paid: boolean;
      method: string | null;
      booker: string;
      mobile: string;
      players: Player[];
      /** Set when a player's own pass was scanned, rather than the booking's. */
      scannedPlayerId: string | null;
    };

const SCAN_INTERVAL_MS = 250;

export function DeskScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refInput, setRefInput] = useState('');
  const [walkOn, setWalkOn] = useState('');

  const verify = useCallback(async (payload: { token?: string; ref?: string }) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<VerifyResult>('/api/desk/verify', { method: 'POST', body: JSON.stringify(payload) }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setCameraError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in the browser, or key the reference in below.'
          : name === 'NotFoundError'
            ? 'No camera on this device. Key the reference in below.'
            : 'Could not start the camera. Key the reference in below.',
      );
      setScanning(false);
    }
  }, []);

  // Decode loop. Runs only while the camera is on.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const found = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
            if (found?.data) {
              const token = extractToken(found.data);
              // Ignore the same pass held in front of the lens frame after frame.
              if (token && token !== lastTokenRef.current) {
                lastTokenRef.current = token;
                void verify({ token });
              }
            }
          }
        }
      }
      timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
    };

    let timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanning, verify]);

  useEffect(() => stopCamera, [stopCamera]);

  async function toggleCheckIn(player: Player) {
    if (!result || !('players' in result)) return;
    const booking = result;
    try {
      await api('/api/desk/checkin', {
        method: 'POST',
        body: JSON.stringify({ playerId: player.id, checkedIn: !player.checkedIn }),
      });
      setResult({
        ...booking,
        players: booking.players.map((p) => (p.id === player.id ? { ...p, checkedIn: !p.checkedIn } : p)),
      });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not update the roster.');
    }
  }

  async function addWalkOn() {
    if (!result || !('players' in result) || !walkOn.trim()) return;
    const booking = result;
    try {
      const player = await api<{ id: string; name: string; checkedIn: boolean }>('/api/desk/party', {
        method: 'POST',
        body: JSON.stringify({ ref: booking.ref, name: walkOn }),
      });
      setResult({ ...booking, players: [...booking.players, { ...player, isBooker: false }] });
      setWalkOn('');
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not add the player.');
    }
  }

  const checkedCount = result && 'players' in result ? result.players.filter((p) => p.checkedIn).length : 0;

  return (
    <div className="flow-grid">
      <div>
        <div style={{ borderRadius: 14, padding: 20, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="label-caps" style={{ marginBottom: 12 }}>
            Scanner
          </div>

          <div className="scanner-frame">
            <video ref={videoRef} playsInline muted hidden={!scanning} />
            <canvas ref={canvasRef} hidden />
            <div className="scanner-reticle" />
            {!scanning && (
              <span className="scanner-hint">
                {cameraError ? cameraError.toUpperCase() : 'CAMERA OFF — START TO SCAN A PASS'}
              </span>
            )}
          </div>

          <button
            className={scanning ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block'}
            style={{ padding: 11 }}
            onClick={() => (scanning ? stopCamera() : void startCamera())}
          >
            {scanning ? 'Stop the camera' : 'Start the camera'}
          </button>

          <hr className="hr" style={{ margin: '18px 0' }} />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              lastTokenRef.current = null;
              void verify({ ref: refInput });
            }}
          >
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="desk-ref">Or key in the reference</label>
              <input
                id="desk-ref"
                className="input mono"
                placeholder="PL-XXXXXX"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value.toUpperCase())}
              />
            </div>
            <button className="btn btn-secondary btn-block" style={{ padding: 9 }} disabled={busy || !refInput.trim()}>
              {busy ? 'Checking…' : 'Verify reference'}
            </button>
          </form>
        </div>

        <a className="btn btn-ghost" style={{ marginTop: 12 }} href="/">
          <span aria-hidden="true">←</span> Leave staff view
        </a>
      </div>

      <div>
        {error && (
          <div className="banner banner-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {!result && (
          <div style={{ borderRadius: 14, padding: 26, boxShadow: 'var(--shadow-sm)', color: 'var(--color-neutral-600)', fontSize: 14 }}>
            Waiting for a pass. Nothing scanned yet.
          </div>
        )}

        {result && result.outcome === 'invalid' && (
          <div style={{ borderRadius: 14, padding: 26, background: 'var(--color-accent-100)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="tag tag-outline" style={{ marginBottom: 12 }}>
              Do not admit
            </div>
            <h4 style={{ marginBottom: 6 }}>Pass did not verify</h4>
            <p style={{ fontSize: 13.5, color: 'var(--color-neutral-700)', margin: 0 }}>{result.reason}</p>
          </div>
        )}

        {result && result.outcome === 'not_found' && (
          <div style={{ borderRadius: 14, padding: 26, background: 'var(--color-accent-100)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="tag tag-outline" style={{ marginBottom: 12 }}>
              Not recognised
            </div>
            <h4 style={{ marginBottom: 6 }}>{result.reason}</h4>
            <p style={{ fontSize: 13.5, color: 'var(--color-neutral-700)', margin: 0 }}>
              Ask the player to open the pass emailed to them, or check the reference for typos. Do not admit the party
              on an unverified reference.
            </p>
          </div>
        )}

        {result && (result.outcome === 'admit' || result.outcome === 'expired' || result.outcome === 'refuse') && (
          <div style={{ borderRadius: 14, padding: 26, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)' }}>
            <div className="row" style={{ marginBottom: 16 }}>
              {result.outcome === 'admit' ? (
                <span className="tag tag-accent">Booking verified</span>
              ) : result.outcome === 'expired' ? (
                <span className="tag tag-neutral">Slot already finished</span>
              ) : (
                <span className="tag tag-outline">Do not admit — {result.status.toLowerCase()}</span>
              )}
              {result.paid && <span className="tag tag-accent-2">Paid{result.method ? ` · ${result.method}` : ''}</span>}
              {!result.paid && <span className="tag tag-outline">Unpaid</span>}
            </div>

            <div className="mono" style={{ fontSize: 22, letterSpacing: '0.06em', marginBottom: 18 }}>
              {result.ref}
            </div>

            <div className="stack" style={{ gap: 12, fontSize: 14, marginBottom: 24 }}>
              {[
                ['Court', result.court],
                ['Slot', result.slot],
                ['Amount paid', result.total],
                ['Booker', `${result.booker} · ${result.mobile}`],
              ].map(([label, value], i, all) => (
                <div
                  key={label}
                  className="summary-row"
                  style={i < all.length - 1 ? { paddingBottom: 11, borderBottom: '1px solid var(--color-divider)' } : undefined}
                >
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>

            {result.scannedPlayerId && (
              <div className="banner banner-ok" style={{ marginBottom: 16 }}>
                Player pass scanned:{' '}
                <strong>{result.players.find((p) => p.id === result.scannedPlayerId)?.name ?? 'this player'}</strong>.
                Check them in below — the rest of the party can come later on their own passes.
              </div>
            )}

            <div className="label-caps" style={{ marginBottom: 10 }}>
              Party roster — {checkedCount} of {result.players.length} checked in
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {result.players.map((p) => (
                <div key={p.id} className="roster-row" data-checked={p.checkedIn} data-scanned={p.id === result.scannedPlayerId}>
                  <span>
                    {p.name}
                    {p.isBooker ? ' (booker)' : ''}
                    {p.id === result.scannedPlayerId ? ' · scanned' : ''}
                  </span>
                  <button
                    className={p.checkedIn ? 'btn btn-ghost' : 'btn btn-secondary'}
                    disabled={result.outcome !== 'admit'}
                    onClick={() => void toggleCheckIn(p)}
                  >
                    {p.checkedIn ? 'Checked in' : 'Check in'}
                  </button>
                </div>
              ))}
            </div>

            {result.outcome === 'admit' && (
              <form
                className="row"
                style={{ marginTop: 14 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void addWalkOn();
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder="Add a walk-on player"
                  value={walkOn}
                  onChange={(e) => setWalkOn(e.target.value)}
                />
                <button className="btn btn-secondary" disabled={walkOn.trim().length < 2}>
                  Add
                </button>
              </form>
            )}

            <p className="muted" style={{ fontSize: 11.5, margin: '16px 0 0' }}>
              Players who signed in through the booker&rsquo;s join link arrive pre-registered; walk-on guests can be
              added here, as many as turn up.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A pass QR encodes the verify URL. Accept either that or a bare token, so a
 * pass shown from an older email still scans.
 */
function extractToken(scanned: string): string | null {
  try {
    const url = new URL(scanned);
    return url.searchParams.get('t');
  } catch {
    // Two shapes: a booking pass (ref.signature) and a player pass
    // (ref.playerId.signature).
    return /^PL-[A-Z0-9]{6}(?:\.[A-Za-z0-9_-]+){1,2}$/.test(scanned.trim()) ? scanned.trim() : null;
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import type { Booking } from '@prisma/client';
import { env, siteUrl } from './env';
import { prisma } from './db';

/**
 * Entry passes.
 *
 * The mockup's QR carried its claims in the clear:
 *
 *   PICKLELOUNGE/V1 / REF:PL-K7Q2M9 / COURT:B / PAID:₱650/GCASH
 *
 * — which anyone could reproduce with a QR generator and walk in on. Here the
 * QR carries a reference and a signature over it, and the desk learns the
 * court, the slot and the payment status from the database rather than from
 * the pass. A forged pass fails the signature check; a genuine pass for a
 * cancelled booking is recognised and refused on status.
 *
 * The signature mixes the app secret with a per-booking secret, so a single
 * booking's pass can be invalidated (by rotating that row's secret) without
 * invalidating every pass ever issued.
 */

const SIGNATURE_BYTES = 16;

function signature(ref: string, passSecret: string): string {
  return createHmac('sha256', env.APP_SECRET)
    .update(`pass.v1:${ref}:${passSecret}`)
    .digest('base64url')
    .slice(0, Math.ceil((SIGNATURE_BYTES * 8) / 6));
}

export function makePassToken(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${booking.ref}.${signature(booking.ref, booking.passSecret)}`;
}

/** The URL encoded in the QR — a phone camera opens the desk's verify screen. */
export function passUrl(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${siteUrl}/desk/verify?t=${encodeURIComponent(makePassToken(booking))}`;
}

/** The booker's own copy of the pass, reachable without staff access. */
export function passPageUrl(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${siteUrl}/pass/${encodeURIComponent(makePassToken(booking))}`;
}

export function joinUrl(booking: Pick<Booking, 'ref'>): string {
  return `${siteUrl}/join/${booking.ref}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type PassVerification =
  | { valid: true; booking: Booking & { court: { code: string; name: string } } }
  | { valid: false; reason: 'malformed' | 'unknown' | 'bad_signature' };

/**
 * Check a scanned token against the database.
 *
 * Returns the booking whatever its status — a cancelled or unpaid booking is a
 * *valid pass for a booking that should not be admitted*, and the desk needs to
 * see the difference between that and a forgery.
 */
export async function verifyPassToken(token: string): Promise<PassVerification> {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [ref, provided] = parts;
  if (!/^PL-[A-Z0-9]{6}$/.test(ref)) return { valid: false, reason: 'malformed' };

  const booking = await prisma.booking.findUnique({
    where: { ref },
    include: { court: { select: { code: true, name: true } } },
  });
  if (!booking) return { valid: false, reason: 'unknown' };

  if (!constantTimeEquals(provided, signature(booking.ref, booking.passSecret))) {
    return { valid: false, reason: 'bad_signature' };
  }
  return { valid: true, booking };
}

export async function renderQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    // Colours are applied by the caller's CSS; the pass card is a light panel
    // in an otherwise dark theme, so the QR is drawn dark-on-light.
    color: { dark: '#292b31', light: '#0000' },
  });
}

export async function renderQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#161826', light: '#ffffff' },
  });
}

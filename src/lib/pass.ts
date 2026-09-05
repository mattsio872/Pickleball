import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import type { Booking, PlayerRegistration } from '@prisma/client';
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
  return createHmac('sha256', env().APP_SECRET)
    .update(`pass.v1:${ref}:${passSecret}`)
    .digest('base64url')
    .slice(0, Math.ceil((SIGNATURE_BYTES * 8) / 6));
}

export function makePassToken(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${booking.ref}.${signature(booking.ref, booking.passSecret)}`;
}

/** The URL encoded in the QR — a phone camera opens the desk's verify screen. */
export function passUrl(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${siteUrl()}/desk/verify?t=${encodeURIComponent(makePassToken(booking))}`;
}

/** The booker's own copy of the pass, reachable without staff access. */
export function passPageUrl(booking: Pick<Booking, 'ref' | 'passSecret'>): string {
  return `${siteUrl()}/pass/${encodeURIComponent(makePassToken(booking))}`;
}

export function joinUrl(booking: Pick<Booking, 'ref'>): string {
  return `${siteUrl()}/join/${booking.ref}`;
}

/**
 * A player's own pass.
 *
 * The booker's pass admits the party, but a party rarely arrives together —
 * somebody comes from work, somebody else brings the car round. A player pass
 * lets one person be admitted on their own, and tells the desk *who* walked in
 * rather than only that somebody from the booking did.
 *
 * It is signed the same way and against the same per-booking secret, so
 * invalidating a booking's pass invalidates its players' passes with it. The
 * player id is inside the signed string, so a player pass cannot be edited into
 * another player's.
 */
function playerSignature(ref: string, playerId: string, passSecret: string): string {
  return createHmac('sha256', env().APP_SECRET)
    .update(`player.v1:${ref}:${playerId}:${passSecret}`)
    .digest('base64url')
    .slice(0, Math.ceil((SIGNATURE_BYTES * 8) / 6));
}

export function makePlayerToken(
  booking: Pick<Booking, 'ref' | 'passSecret'>,
  player: Pick<PlayerRegistration, 'id'>,
): string {
  return `${booking.ref}.${player.id}.${playerSignature(booking.ref, player.id, booking.passSecret)}`;
}

/** What a player's QR encodes — the same desk screen the booker's pass opens. */
export function playerPassUrl(
  booking: Pick<Booking, 'ref' | 'passSecret'>,
  player: Pick<PlayerRegistration, 'id'>,
): string {
  return `${siteUrl()}/desk/verify?t=${encodeURIComponent(makePlayerToken(booking, player))}`;
}

/** A player's own copy of their pass, to keep on their phone. */
export function playerPassPageUrl(
  booking: Pick<Booking, 'ref' | 'passSecret'>,
  player: Pick<PlayerRegistration, 'id'>,
): string {
  return `${siteUrl()}/pass/player/${encodeURIComponent(makePlayerToken(booking, player))}`;
}

/** Where the downloadable PNG of any pass token lives. */
export function qrImagePath(token: string): string {
  return `/api/pass/${encodeURIComponent(token)}/qr.png`;
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

export type PlayerVerification =
  | {
      valid: true;
      booking: Booking & { court: { code: string; name: string } };
      player: PlayerRegistration;
    }
  | { valid: false; reason: 'malformed' | 'unknown' | 'bad_signature' };

/** Check a scanned player token. Like a booking pass, status is not judged here. */
export async function verifyPlayerToken(token: string): Promise<PlayerVerification> {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [ref, playerId, provided] = parts;
  if (!/^PL-[A-Z0-9]{6}$/.test(ref) || !/^[A-Za-z0-9_-]{1,64}$/.test(playerId)) {
    return { valid: false, reason: 'malformed' };
  }

  const booking = await prisma.booking.findUnique({
    where: { ref },
    include: { court: { select: { code: true, name: true } } },
  });
  if (!booking) return { valid: false, reason: 'unknown' };

  if (!constantTimeEquals(provided, playerSignature(booking.ref, playerId, booking.passSecret))) {
    return { valid: false, reason: 'bad_signature' };
  }

  const player = await prisma.playerRegistration.findUnique({ where: { id: playerId } });
  // A signature that verifies for a player who has since been taken off the
  // roster is not a forgery, but there is nobody to admit.
  if (!player || player.bookingId !== booking.id) return { valid: false, reason: 'unknown' };

  return { valid: true, booking, player };
}

export type ScanVerification =
  | ({ kind: 'booking' } & PassVerification)
  | ({ kind: 'player' } & PlayerVerification);

/**
 * Verify whatever the desk just scanned.
 *
 * The two kinds are told apart by shape rather than by trying each in turn, so
 * a malformed token is reported as malformed instead of as somebody else's
 * failed signature.
 */
export async function verifyScannedToken(token: string): Promise<ScanVerification> {
  const parts = token.split('.');
  if (parts.length === 3) return { kind: 'player', ...(await verifyPlayerToken(token)) };
  return { kind: 'booking', ...(await verifyPassToken(token)) };
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

/**
 * The QR as a PNG, for saving to a phone's photo roll.
 *
 * Rendered with a white quiet zone rather than the transparent background the
 * on-screen SVG uses: a transparent QR saved into a gallery and reopened on a
 * dark theme is a black square, which no scanner can read.
 */
export async function renderQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 768,
    color: { dark: '#161826ff', light: '#ffffffff' },
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

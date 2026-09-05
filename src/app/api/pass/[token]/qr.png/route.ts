import { NextResponse } from 'next/server';
import { passUrl, playerPassUrl, renderQrPng, verifyScannedToken } from '@/lib/pass';
import { route } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The pass QR as a downloadable PNG.
 *
 * The on-screen QR is an inline SVG, which a phone cannot long-press and save
 * and a browser cannot download — so a party that keeps its pass in the photo
 * roll rather than in an inbox had nothing to keep. This serves the same code
 * as an image file.
 *
 * It is guarded exactly as the pass page is: holding the signed token is the
 * credential, and an altered one renders nothing. Nothing about the booking is
 * disclosed here beyond the QR itself, which the holder already has.
 */
function safeFilename(parts: string[]): string {
  const stem = parts
    .join('-')
    .normalize('NFKD')
    // Drop the accents NFKD split off rather than turning each into a dash,
    // which would spell María as "Mari-a".
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return `${stem || 'pass'}.png`;
}

export const GET = route(async (_request: Request, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params;
  const verification = await verifyScannedToken(decodeURIComponent(token));

  if (!verification.valid) {
    // Never distinguishes "no such booking" from "bad signature": to anyone
    // without a genuine token, both are simply not an image.
    throw new NotFoundError('That pass could not be read.');
  }

  const target =
    verification.kind === 'player'
      ? playerPassUrl(verification.booking, verification.player)
      : passUrl(verification.booking);
  const filename =
    verification.kind === 'player'
      ? safeFilename([verification.booking.ref, verification.player.name, 'pass'])
      : safeFilename([verification.booking.ref, 'pass']);

  const png = await renderQrPng(target);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.byteLength),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A pass QR never changes, but it is only ever fetched by someone holding
      // the token, so it stays out of shared caches.
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/pass/[token]/qr.png/route';
import { prisma } from '@/lib/db';
import { createHold } from '@/lib/booking';
import { makePassToken, makePlayerToken, passUrl, playerPassUrl } from '@/lib/pass';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

/**
 * The pass QR as a file.
 *
 * On screen the QR is an inline SVG, which cannot be long-pressed and saved,
 * so a party that keeps its pass in the photo roll had nothing to keep. The
 * signed token is the whole credential here, exactly as on the pass page — so
 * what matters is that a genuine token yields a real image and that anything
 * else yields nothing at all.
 */

let courtId: string;

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtId = courts[0].id;
});

async function makeBooking() {
  return createHold(
    {
      courtId,
      dayKey: TEST_DAY,
      startMinutes: 19 * 60,
      durationMinutes: 60,
      customerName: 'Juan dela Cruz',
      customerEmail: 'juan@example.com',
      customerMobile: '0917 555 0134',
    },
    NOW,
  );
}

function fetchQr(token: string) {
  return GET(new Request('http://localhost/'), { params: Promise.resolve({ token }) });
}

describe('downloading a booking pass', () => {
  it('returns a PNG the browser will save, named after the booking', async () => {
    const booking = await makeBooking();

    const response = await fetchQr(makePassToken(booking));
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${booking.ref}-pass.png"`,
    );
    expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('keeps the image out of shared caches', async () => {
    const booking = await makeBooking();
    const response = await fetchQr(makePassToken(booking));
    expect(response.headers.get('cache-control')).toMatch(/private/);
  });
});

describe('downloading a player pass', () => {
  it('names the file after the player, safely', async () => {
    const booking = await makeBooking();
    const player = await prisma.playerRegistration.create({
      data: { bookingId: booking.id, name: 'María "Ria" Reyes/Cruz' },
    });

    const response = await fetchQr(makePlayerToken(booking, player));

    expect(response.status).toBe(200);
    const disposition = response.headers.get('content-disposition') ?? '';
    // A name goes into a filename, and a quote or a slash in one would either
    // break the header or reach for a directory.
    expect(disposition).not.toMatch(/["/\\]pass|Mar[íi]a"/);
    expect(disposition).toBe(`attachment; filename="${booking.ref}-Maria-Ria-Reyes-Cruz-pass.png"`);
  });
});

describe('anything but a genuine token', () => {
  it('is not an image, and does not say why', async () => {
    const booking = await makeBooking();
    const [ref] = makePassToken(booking).split('.');

    for (const token of [`${ref}.AAAAAAAAAAAAAAAAAAAAAA`, 'PL-ZZZZZZ.AAAAAAAAAAAAAAAAAAAAAA', 'junk']) {
      const response = await fetchQr(token);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/json/);
      // The same answer whether the booking is unknown or the signature is
      // wrong: a probe learns nothing about which references exist.
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe('That pass could not be read.');
    }
  });
});

describe('what the saved image actually carries', () => {
  /** Decode the PNG the way a scanner would, rather than trusting our own writer. */
  function decode(png: Buffer): string | null {
    const image = PNG.sync.read(png);
    return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
  }

  it('scans back to the same desk URL the on-screen pass shows', async () => {
    const booking = await makeBooking();
    const response = await fetchQr(makePassToken(booking));

    expect(decode(Buffer.from(await response.arrayBuffer()))).toBe(passUrl(booking));
  });

  it("scans back to the player's own pass, not the booking's", async () => {
    const booking = await makeBooking();
    const player = await prisma.playerRegistration.create({
      data: { bookingId: booking.id, name: 'Maria Reyes' },
    });

    const decoded = decode(Buffer.from(await (await fetchQr(makePlayerToken(booking, player))).arrayBuffer()));

    expect(decoded).toBe(playerPassUrl(booking, player));
    expect(decoded).not.toBe(passUrl(booking));
  });

  it('is opaque, so a gallery on a dark theme does not black it out', async () => {
    const booking = await makeBooking();
    const image = PNG.sync.read(Buffer.from(await (await fetchQr(makePassToken(booking))).arrayBuffer()));
    // Every fourth byte is alpha; a transparent QR saved to a phone and
    // reopened on black is an unscannable square.
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] !== 255) throw new Error(`transparent pixel at byte ${i}`);
    }
  });
});

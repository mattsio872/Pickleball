import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold } from '@/lib/booking';
import {
  makePassToken,
  makePlayerToken,
  verifyPassToken,
  verifyPlayerToken,
  verifyScannedToken,
  passUrl,
  playerPassUrl,
  joinUrl,
  renderQrPng,
} from '@/lib/pass';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

let courtId: string;
const customer = {
  customerName: 'Juan dela Cruz',
  customerEmail: 'juan@example.com',
  customerMobile: '0917 555 0134',
};

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtId = courts[0].id;
});

async function makeBooking() {
  return createHold({ courtId, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer }, NOW);
}

describe('entry passes', () => {
  it('verifies a genuine pass', async () => {
    const booking = await makeBooking();
    const result = await verifyPassToken(makePassToken(booking));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.booking.ref).toBe(booking.ref);
  });

  it('rejects a tampered signature', async () => {
    const booking = await makeBooking();
    const token = makePassToken(booking);
    const [ref] = token.split('.');
    const result = await verifyPassToken(`${ref}.AAAAAAAAAAAAAAAAAAAAAA`);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it("rejects one booking's signature presented for another", async () => {
    const first = await makeBooking();
    const second = await createHold(
      { courtId, dayKey: TEST_DAY, startMinutes: 20 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    const [, stolenSignature] = makePassToken(second).split('.');
    const result = await verifyPassToken(`${first.ref}.${stolenSignature}`);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a reference that does not exist', async () => {
    const result = await verifyPassToken('PL-ZZZZZZ.AAAAAAAAAAAAAAAAAAAAAA');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('unknown');
  });

  it('rejects anything that is not a pass', async () => {
    for (const junk of ['', 'hello', 'PL-ABC.sig.extra', 'lowercase.sig', 'PL-TOOLONG9.sig']) {
      const result = await verifyPassToken(junk);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('malformed');
    }
  });

  it('stops verifying once the booking secret is rotated', async () => {
    const booking = await makeBooking();
    const token = makePassToken(booking);
    expect((await verifyPassToken(token)).valid).toBe(true);

    await prisma.booking.update({ where: { id: booking.id }, data: { passSecret: 'rotated-secret' } });
    const after = await verifyPassToken(token);
    expect(after.valid).toBe(false);
    if (!after.valid) expect(after.reason).toBe('bad_signature');

    // Other bookings are unaffected by one revocation.
    const other = await createHold(
      { courtId, dayKey: TEST_DAY, startMinutes: 21 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    expect((await verifyPassToken(makePassToken(other))).valid).toBe(true);
  });

  it('carries no booking details in the QR itself', async () => {
    const booking = await makeBooking();
    const url = passUrl(booking);
    // The pass asserts nothing the desk should be reading off it — no court,
    // no price, no payment status. Only a reference and a signature.
    expect(url).not.toMatch(/650|PAID|Center|Court/i);
    expect(url).toContain(booking.ref);
  });

  it('builds a join link from the reference', async () => {
    const booking = await makeBooking();
    expect(joinUrl(booking)).toMatch(new RegExp(`/join/${booking.ref}$`));
  });
});

describe('player passes', () => {
  async function bookingWithPlayer(name = 'Maria Reyes') {
    const booking = await makeBooking();
    const player = await prisma.playerRegistration.create({ data: { bookingId: booking.id, name } });
    return { booking, player };
  }

  it('verifies a genuine player pass, and says who it admits', async () => {
    const { booking, player } = await bookingWithPlayer();
    const result = await verifyPlayerToken(makePlayerToken(booking, player));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.player.id).toBe(player.id);
      expect(result.player.name).toBe('Maria Reyes');
      expect(result.booking.ref).toBe(booking.ref);
    }
  });

  it("refuses one player's signature presented for another", async () => {
    const { booking, player } = await bookingWithPlayer();
    const other = await prisma.playerRegistration.create({ data: { bookingId: booking.id, name: 'Ana Cruz' } });
    const [, , signature] = makePlayerToken(booking, other).split('.');

    const result = await verifyPlayerToken(`${booking.ref}.${player.id}.${signature}`);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('refuses a player who has been taken off the roster', async () => {
    const { booking, player } = await bookingWithPlayer();
    const token = makePlayerToken(booking, player);
    await prisma.playerRegistration.delete({ where: { id: player.id } });

    const result = await verifyPlayerToken(token);
    expect(result.valid).toBe(false);
    // Not a forgery — the signature is ours — but there is nobody to admit.
    if (!result.valid) expect(result.reason).toBe('unknown');
  });

  it('falls with the booking pass when the booking secret is rotated', async () => {
    const { booking, player } = await bookingWithPlayer();
    const token = makePlayerToken(booking, player);
    expect((await verifyPlayerToken(token)).valid).toBe(true);

    await prisma.booking.update({ where: { id: booking.id }, data: { passSecret: 'rotated-secret' } });
    const after = await verifyPlayerToken(token);
    expect(after.valid).toBe(false);
    if (!after.valid) expect(after.reason).toBe('bad_signature');
  });

  it('asserts nothing about the player in the QR itself', async () => {
    const { booking, player } = await bookingWithPlayer();
    const url = playerPassUrl(booking, player);
    expect(url).not.toMatch(/Maria|Reyes|PAID|Center/i);
    expect(url).toContain(booking.ref);
  });
});

describe('what the desk scanned', () => {
  it('tells a player pass from a booking pass', async () => {
    const booking = await makeBooking();
    const player = await prisma.playerRegistration.create({ data: { bookingId: booking.id, name: 'Ana Cruz' } });

    const scannedBooking = await verifyScannedToken(makePassToken(booking));
    expect(scannedBooking.kind).toBe('booking');
    expect(scannedBooking.valid).toBe(true);

    const scannedPlayer = await verifyScannedToken(makePlayerToken(booking, player));
    expect(scannedPlayer.kind).toBe('player');
    expect(scannedPlayer.valid).toBe(true);
  });

  it('reports junk as malformed rather than as a failed signature', async () => {
    const result = await verifyScannedToken('not-a-pass-at-all');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed');
  });
});

describe('the downloadable QR', () => {
  it('renders a real PNG', async () => {
    const booking = await makeBooking();
    const png = await renderQrPng(passUrl(booking));
    // PNG magic number: a browser or a phone gallery will only accept the file
    // if it is genuinely one.
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.byteLength).toBeGreaterThan(500);
  });
});

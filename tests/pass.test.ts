import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold } from '@/lib/booking';
import { makePassToken, verifyPassToken, passUrl, joinUrl } from '@/lib/pass';
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

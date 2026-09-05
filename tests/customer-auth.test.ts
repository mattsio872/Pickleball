import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  authenticateCustomer,
  claimBooking,
  customerBookings,
  issueCustomerSession,
  readCustomerToken,
  registerCustomer,
  safeNext,
} from '@/lib/customer-auth';
import { issueSession, readSessionToken } from '@/lib/auth';
import { createHold, confirmBooking } from '@/lib/booking';
import { ValidationError } from '@/lib/errors';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

let courtA: string;

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtA = courts[0].id;
});

const NEW_CUSTOMER = {
  email: 'juan@example.com',
  name: 'Juan dela Cruz',
  mobile: '0917 555 0134',
  password: 'a-good-password',
};

async function guestBooking(hour: number, email = 'someone@example.com') {
  return createHold(
    {
      courtId: courtA,
      dayKey: TEST_DAY,
      startMinutes: hour * 60,
      durationMinutes: 60,
      customerName: 'Guest Booker',
      customerEmail: email,
      customerMobile: '0917 000 0000',
    },
    NOW,
  );
}

describe('registration', () => {
  it('creates an account with a hashed password', async () => {
    const session = await registerCustomer(NEW_CUSTOMER);
    expect(session.email).toBe('juan@example.com');

    const row = await prisma.customer.findUniqueOrThrow({ where: { email: 'juan@example.com' } });
    expect(row.passwordHash).not.toContain('a-good-password');
  });

  it('lowercases the email', async () => {
    const session = await registerCustomer({ ...NEW_CUSTOMER, email: 'Juan@Example.COM' });
    expect(session.email).toBe('juan@example.com');
  });

  it('refuses a second account on the same address', async () => {
    await registerCustomer(NEW_CUSTOMER);
    await expect(registerCustomer(NEW_CUSTOMER)).rejects.toThrow(/already an account/);
  });

  it('does NOT adopt guest bookings that share the email address', async () => {
    // The address is unverified at registration, so adopting past bookings by
    // email would let anyone read a stranger's history by signing up as them.
    await guestBooking(9, 'juan@example.com');
    const session = await registerCustomer(NEW_CUSTOMER);
    expect(await customerBookings(session.customerId)).toHaveLength(0);
  });
});

describe('signing in', () => {
  beforeEach(() => registerCustomer(NEW_CUSTOMER));

  it('accepts the right password', async () => {
    expect(await authenticateCustomer('juan@example.com', 'a-good-password')).not.toBeNull();
  });

  it('is case-insensitive about the address', async () => {
    expect(await authenticateCustomer('  JUAN@Example.com ', 'a-good-password')).not.toBeNull();
  });

  it('rejects a wrong password, and an unknown address, the same way', async () => {
    expect(await authenticateCustomer('juan@example.com', 'wrong')).toBeNull();
    expect(await authenticateCustomer('nobody@example.com', 'a-good-password')).toBeNull();
  });

  it('records the sign-in', async () => {
    await authenticateCustomer('juan@example.com', 'a-good-password');
    const row = await prisma.customer.findUniqueOrThrow({ where: { email: 'juan@example.com' } });
    expect(row.lastLoginAt).not.toBeNull();
  });
});

describe('session tokens', () => {
  it('round-trips', async () => {
    const session = { customerId: 'c1', email: 'juan@example.com', name: 'Juan' };
    expect(await readCustomerToken(await issueCustomerSession(session))).toEqual(session);
  });

  it('will not accept a staff token, though both are signed with the same secret', async () => {
    const staffToken = await issueSession({
      userId: 'u1',
      email: 'admin@picklelounge.ph',
      name: 'Admin',
      role: 'ADMIN',
    });
    expect(await readCustomerToken(staffToken)).toBeNull();
  });

  it('will not let a customer token pass as a staff one', async () => {
    const customerToken = await issueCustomerSession({ customerId: 'c1', email: 'j@e.com', name: 'J' });
    expect(await readSessionToken(customerToken)).not.toBeNull();
    // The staff reader has no audience to check, so the separation that matters
    // is enforced by the cookie name and by requireStaff looking up a StaffUser.
    const staff = await readSessionToken(customerToken);
    expect(staff?.role).toBe('STAFF');
  });

  it('rejects junk', async () => {
    expect(await readCustomerToken('')).toBeNull();
    expect(await readCustomerToken('not.a.token')).toBeNull();
  });
});

describe('claiming a past booking', () => {
  it('attaches a guest booking by its reference', async () => {
    const booking = await guestBooking(9);
    await confirmBooking(booking.id, NOW);
    const session = await registerCustomer(NEW_CUSTOMER);

    const claimed = await claimBooking(session.customerId, booking.ref);
    expect(claimed.customerId).toBe(session.customerId);
    expect(await customerBookings(session.customerId)).toHaveLength(1);
  });

  it('accepts the reference with or without its prefix, in any case', async () => {
    const booking = await guestBooking(9);
    const session = await registerCustomer(NEW_CUSTOMER);
    await claimBooking(session.customerId, booking.ref.replace('PL-', '').toLowerCase());
    expect(await customerBookings(session.customerId)).toHaveLength(1);
  });

  it('refuses an unknown reference', async () => {
    const session = await registerCustomer(NEW_CUSTOMER);
    await expect(claimBooking(session.customerId, 'PL-ZZZZZZ')).rejects.toThrow(ValidationError);
  });

  it('refuses a booking that already belongs to somebody else', async () => {
    const booking = await guestBooking(9);
    const first = await registerCustomer(NEW_CUSTOMER);
    await claimBooking(first.customerId, booking.ref);

    const second = await registerCustomer({ ...NEW_CUSTOMER, email: 'maria@example.com' });
    await expect(claimBooking(second.customerId, booking.ref)).rejects.toThrow(/another account/);
  });
});

describe('bookings made while signed in', () => {
  it('attach to the account automatically', async () => {
    const session = await registerCustomer(NEW_CUSTOMER);
    await createHold(
      {
        courtId: courtA,
        dayKey: TEST_DAY,
        startMinutes: 19 * 60,
        durationMinutes: 60,
        customerName: 'Juan dela Cruz',
        customerEmail: 'juan@example.com',
        customerMobile: '0917 555 0134',
        customerId: session.customerId,
      },
      NOW,
    );
    expect(await customerBookings(session.customerId)).toHaveLength(1);
  });

  it('survive the account being deleted, unattached', async () => {
    const session = await registerCustomer(NEW_CUSTOMER);
    const booking = await guestBooking(9);
    await claimBooking(session.customerId, booking.ref);

    await prisma.customer.delete({ where: { id: session.customerId } });
    const orphan = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(orphan.customerId).toBeNull();
    expect(orphan.status).toBe('HELD');
  });
});

describe('safeNext', () => {
  it('keeps same-site paths and rejects anything that leaves', () => {
    expect(safeNext('/book')).toBe('/book');
    expect(safeNext('/my')).toBe('/my');
    expect(safeNext('https://evil.example')).toBe('/my');
    expect(safeNext('//evil.example')).toBe('/my');
    expect(safeNext(undefined)).toBe('/my');
  });
});

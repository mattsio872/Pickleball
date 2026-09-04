import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold, confirmBooking } from '@/lib/booking';
import { customerHistory, listCustomers } from '@/lib/customers';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

let courtA: string;
let courtB: string;

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtA = courts[0].id;
  courtB = courts[1].id;
});

async function book(options: {
  courtId: string;
  hour: number;
  name: string;
  email: string;
  mobile?: string;
  confirm?: boolean;
}) {
  const booking = await createHold(
    {
      courtId: options.courtId,
      dayKey: TEST_DAY,
      startMinutes: options.hour * 60,
      durationMinutes: 60,
      customerName: options.name,
      customerEmail: options.email,
      customerMobile: options.mobile ?? '0917 000 0000',
    },
    NOW,
  );
  if (options.confirm) await confirmBooking(booking.id, NOW);
  return booking;
}

describe('customer directory', () => {
  it('groups bookings by email address', async () => {
    await book({ courtId: courtA, hour: 9, name: 'Juan dela Cruz', email: 'juan@example.com', confirm: true });
    await book({ courtId: courtA, hour: 11, name: 'Juan dela Cruz', email: 'juan@example.com', confirm: true });
    await book({ courtId: courtA, hour: 13, name: 'Maria Reyes', email: 'maria@example.com', confirm: true });

    const { customers, total } = await listCustomers();
    expect(total).toBe(2);

    const juan = customers.find((c) => c.email === 'juan@example.com')!;
    expect(juan.bookings).toBe(2);
    expect(juan.confirmedBookings).toBe(2);
    expect(juan.totalSpentCents).toBe(130000);
  });

  it('counts only confirmed bookings towards spend', async () => {
    await book({ courtId: courtA, hour: 9, name: 'Juan', email: 'juan@example.com', confirm: true });
    // Held but never paid.
    await book({ courtId: courtA, hour: 11, name: 'Juan', email: 'juan@example.com' });

    const { customers } = await listCustomers();
    const juan = customers[0];
    expect(juan.bookings).toBe(2);
    expect(juan.confirmedBookings).toBe(1);
    expect(juan.totalSpentCents).toBe(65000);
  });

  it('normalises the email, so casing does not split a customer in two', async () => {
    await book({ courtId: courtA, hour: 9, name: 'Juan', email: 'Juan@Example.com', confirm: true });
    await book({ courtId: courtA, hour: 11, name: 'Juan', email: 'juan@example.com', confirm: true });

    const { total, customers } = await listCustomers();
    expect(total).toBe(1);
    expect(customers[0].bookings).toBe(2);
  });

  it('shows the most recent name and number', async () => {
    await book({ courtId: courtA, hour: 9, name: 'Juan D.', email: 'juan@example.com', mobile: '0917 111 1111' });
    await new Promise((r) => setTimeout(r, 10)); // distinct createdAt
    await book({ courtId: courtA, hour: 11, name: 'Juan dela Cruz', email: 'juan@example.com', mobile: '0917 222 2222' });

    const { customers } = await listCustomers();
    expect(customers[0].name).toBe('Juan dela Cruz');
    expect(customers[0].mobile).toBe('0917 222 2222');
  });

  it('reports the soonest upcoming confirmed booking', async () => {
    await book({ courtId: courtA, hour: 20, name: 'Juan', email: 'juan@example.com', confirm: true });
    await book({ courtId: courtB, hour: 18, name: 'Juan', email: 'juan@example.com', confirm: true });

    const { customers } = await listCustomers();
    // 6PM comes before 8PM.
    expect(customers[0].upcomingAt).toBe('2026-09-11T10:00:00.000Z');
  });

  it('ignores an unconfirmed booking when reporting what is upcoming', async () => {
    await book({ courtId: courtA, hour: 18, name: 'Juan', email: 'juan@example.com' });
    const { customers } = await listCustomers();
    expect(customers[0].upcomingAt).toBeNull();
  });

  it('searches by name, email, mobile and reference', async () => {
    const booking = await book({
      courtId: courtA,
      hour: 9,
      name: 'Juan dela Cruz',
      email: 'juan@example.com',
      mobile: '0917 555 0134',
      confirm: true,
    });
    await book({ courtId: courtA, hour: 11, name: 'Maria Reyes', email: 'maria@example.com', confirm: true });

    expect((await listCustomers({ search: 'juan' })).total).toBe(1);
    expect((await listCustomers({ search: 'JUAN' })).total).toBe(1);
    expect((await listCustomers({ search: 'maria@example.com' })).total).toBe(1);
    expect((await listCustomers({ search: '555 0134' })).total).toBe(1);
    expect((await listCustomers({ search: booking.ref.toLowerCase() })).total).toBe(1);
    expect((await listCustomers({ search: 'nobody' })).total).toBe(0);
  });

  it('returns one customer full booking history', async () => {
    await book({ courtId: courtA, hour: 9, name: 'Juan', email: 'juan@example.com', confirm: true });
    await book({ courtId: courtA, hour: 11, name: 'Juan', email: 'juan@example.com' });
    await book({ courtId: courtA, hour: 13, name: 'Maria', email: 'maria@example.com', confirm: true });

    const history = await customerHistory('juan@example.com');
    expect(history).toHaveLength(2);
    expect(history.every((b) => b.customerEmail === 'juan@example.com')).toBe(true);
  });

  it('is empty before anyone books', async () => {
    const { customers, total } = await listCustomers();
    expect(total).toBe(0);
    expect(customers).toEqual([]);
  });
});

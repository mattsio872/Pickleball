import { prisma } from './db';

/**
 * The customer directory.
 *
 * There is no customer table: booking is guest checkout, so a "customer" is
 * every booking that shares an email address. Aggregating on read rather than
 * maintaining a table means the directory cannot drift from the bookings it
 * describes, and nobody has to be migrated into existence.
 *
 * Email is the identity. Someone who books twice with different addresses
 * appears twice — which is honest, since nothing ties those bookings together.
 */

export type CustomerSummary = {
  email: string;
  /** From their most recent booking; people re-type their name differently. */
  name: string;
  mobile: string;
  bookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  /** Centavos, confirmed bookings only — held and expired ones were never paid. */
  totalSpentCents: number;
  firstBookedAt: string;
  lastBookedAt: string;
  /** Their next confirmed booking, if they have one coming up. */
  upcomingAt: string | null;
};

export async function listCustomers(options: { search?: string; limit?: number } = {}) {
  const search = options.search?.trim().toLowerCase();
  const limit = options.limit ?? 200;

  const bookings = await prisma.booking.findMany({
    where: search
      ? {
          OR: [
            { customerEmail: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
            { customerMobile: { contains: search } },
            { ref: { contains: search.toUpperCase() } },
          ],
        }
      : undefined,
    select: {
      customerEmail: true,
      customerName: true,
      customerMobile: true,
      status: true,
      totalCents: true,
      startsAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();
  const byEmail = new Map<string, CustomerSummary>();

  for (const booking of bookings) {
    const email = booking.customerEmail;
    const existing = byEmail.get(email);

    if (!existing) {
      // Bookings arrive newest first, so the first one seen carries the most
      // recent name and number.
      byEmail.set(email, {
        email,
        name: booking.customerName,
        mobile: booking.customerMobile,
        bookings: 1,
        confirmedBookings: booking.status === 'CONFIRMED' ? 1 : 0,
        cancelledBookings: booking.status === 'CANCELLED' ? 1 : 0,
        totalSpentCents: booking.status === 'CONFIRMED' ? booking.totalCents : 0,
        firstBookedAt: booking.createdAt.toISOString(),
        lastBookedAt: booking.createdAt.toISOString(),
        upcomingAt:
          booking.status === 'CONFIRMED' && booking.startsAt > now ? booking.startsAt.toISOString() : null,
      });
      continue;
    }

    existing.bookings += 1;
    if (booking.status === 'CONFIRMED') {
      existing.confirmedBookings += 1;
      existing.totalSpentCents += booking.totalCents;
      if (booking.startsAt > now) {
        const soonest = existing.upcomingAt ? new Date(existing.upcomingAt) : null;
        if (!soonest || booking.startsAt < soonest) {
          existing.upcomingAt = booking.startsAt.toISOString();
        }
      }
    }
    if (booking.status === 'CANCELLED') existing.cancelledBookings += 1;
    // Ordered newest first, so anything later is older than what we have.
    existing.firstBookedAt = booking.createdAt.toISOString();
  }

  const customers = [...byEmail.values()].sort(
    (a, b) => new Date(b.lastBookedAt).getTime() - new Date(a.lastBookedAt).getTime(),
  );

  return { customers: customers.slice(0, limit), total: customers.length };
}

/** Every booking for one email address, newest first. */
export async function customerHistory(email: string) {
  return prisma.booking.findMany({
    where: { customerEmail: email.trim().toLowerCase() },
    include: { court: true, players: true },
    orderBy: { startsAt: 'desc' },
    take: 100,
  });
}

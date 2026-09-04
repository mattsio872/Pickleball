import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from './env';
import { prisma } from './db';
import { hashPassword, verifyPassword } from './auth';
import { isUniqueViolation } from './db';
import { AuthError, ValidationError } from './errors';

/**
 * Customer accounts.
 *
 * Deliberately separate from staff auth: a different cookie, a different
 * audience in the token, and no shared session. A customer session must never
 * be mistakable for a staff one, and the two are checked by different code in
 * different places, so keeping them apart is cheaper than keeping them straight.
 *
 * Booking without an account stays possible. An account adds saved details and
 * a record of what you have booked; it is not a gate in front of the court.
 */

export const CUSTOMER_COOKIE = 'pl_customer';
const SESSION_DAYS = 30;
const AUDIENCE = 'customer';

export type CustomerSession = {
  customerId: string;
  email: string;
  name: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().APP_SECRET);
}

export async function issueCustomerSession(session: CustomerSession): Promise<string> {
  return new SignJWT({ email: session.email, name: session.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.customerId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function readCustomerToken(token: string): Promise<CustomerSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      // Without this a staff token would verify here too, since both are signed
      // with the same secret.
      audience: AUDIENCE,
    });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      customerId: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
    };
  } catch {
    return null;
  }
}

/** The signed-in customer, or null. Safe from any server component. */
export async function currentCustomer(): Promise<CustomerSession | null> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;

  const session = await readCustomerToken(token);
  if (!session) return null;

  // The account may have been deleted since the token was issued.
  const exists = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { id: true, email: true, name: true },
  });
  return exists ? { customerId: exists.id, email: exists.email, name: exists.name } : null;
}

export async function requireCustomer(): Promise<CustomerSession> {
  const session = await currentCustomer();
  if (!session) throw new AuthError('Sign in to see your bookings.');
  return session;
}

export function customerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export async function registerCustomer(input: {
  email: string;
  name: string;
  mobile: string;
  password: string;
}): Promise<CustomerSession> {
  const email = input.email.trim().toLowerCase();

  try {
    const customer = await prisma.customer.create({
      data: {
        email,
        name: input.name.trim(),
        mobile: input.mobile.trim(),
        passwordHash: await hashPassword(input.password),
      },
    });

    // Bookings this person made as a guest, before they had an account, are
    // NOT claimed here. Email is unverified at this point, so adopting them
    // would let anyone read a stranger's booking history by registering with
    // their address. They are claimed one at a time, with the reference.
    return { customerId: customer.id, email: customer.email, name: customer.name };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError('There is already an account with that email address. Try signing in.');
    }
    throw error;
  }
}

export async function authenticateCustomer(email: string, password: string): Promise<CustomerSession | null> {
  const customer = await prisma.customer.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!customer) {
    // Spend comparable time so the response does not reveal which addresses
    // have accounts.
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword(password, customer.passwordHash))) return null;

  await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });
  return { customerId: customer.id, email: customer.email, name: customer.name };
}

/**
 * Attach a booking made before the account existed.
 *
 * The reference is the proof: it was emailed to the booker and printed on
 * their pass, and it is not guessable. Requiring it means claiming works
 * without a verified email address, and cannot be used to read somebody
 * else's history.
 */
export async function claimBooking(customerId: string, ref: string) {
  const normalised = ref.trim().toUpperCase().startsWith('PL-')
    ? ref.trim().toUpperCase()
    : `PL-${ref.trim().toUpperCase()}`;

  const booking = await prisma.booking.findUnique({ where: { ref: normalised } });
  if (!booking) throw new ValidationError(`No booking found for ${normalised}.`);
  if (booking.customerId === customerId) {
    throw new ValidationError('That booking is already on your account.');
  }
  if (booking.customerId) {
    throw new ValidationError('That booking belongs to another account.');
  }

  return prisma.booking.update({
    where: { id: booking.id },
    data: { customerId },
    include: { court: true },
  });
}

/** Every booking on the account, soonest first among what is still ahead. */
export async function customerBookings(customerId: string) {
  return prisma.booking.findMany({
    where: { customerId, status: { in: ['CONFIRMED', 'HELD'] } },
    include: { court: true, players: true, payments: { where: { status: 'PAID' }, take: 1 } },
    orderBy: { startsAt: 'desc' },
  });
}

/**
 * A post-sign-in destination that cannot leave the site.
 *
 * `next` arrives from the query string, so an absolute or protocol-relative URL
 * would turn the sign-in page into an open redirect.
 */
export function safeNext(next: string | undefined, fallback = '/my'): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

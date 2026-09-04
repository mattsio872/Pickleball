import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { StaffRole } from '@prisma/client';
import { env } from './env';
import { prisma } from './db';
import { AuthError, ForbiddenError } from './errors';

/**
 * Staff and admin sessions.
 *
 * The design mockup's front desk was a view anyone could reach — it showed
 * bookings, payment status and let players be checked in. Here it sits behind a
 * login, because a scanner that will vouch for "payment verified" is exactly
 * what someone would want to reach without a password.
 *
 * Passwords use scrypt from Node's standard library rather than a native bcrypt
 * binding: one less thing to compile, and it deploys to serverless unchanged.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'pl_staff';
const SESSION_HOURS = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.APP_SECRET);
}

export async function issueSession(session: StaffSession): Promise<string> {
  return new SignJWT({ email: session.email, name: session.name, role: session.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<StaffSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      userId: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      role: payload.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
    };
  } catch {
    return null;
  }
}

/** The signed-in staff member, or null. Safe to call from any server component. */
export async function currentStaff(): Promise<StaffSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export async function requireStaff(): Promise<StaffSession> {
  const session = await currentStaff();
  if (!session) throw new AuthError();
  return session;
}

export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== 'ADMIN') {
    throw new ForbiddenError('That area is limited to venue admins.');
  }
  return session;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  };
}

/** Verifies credentials and records the sign-in. Returns null on any mismatch. */
export async function authenticate(email: string, password: string): Promise<StaffSession | null> {
  const user = await prisma.staffUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    // Spend comparable time on an unknown address so the response does not
    // reveal which staff emails exist.
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  await prisma.staffUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { userId: user.id, email: user.email, name: user.name, role: user.role };
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { authenticate, hashPassword, issueSession, readSessionToken, verifyPassword } from '@/lib/auth';
import { migrateTestDatabase, resetDatabase } from './helpers';

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());
beforeEach(() => resetDatabase());

describe('password hashing', () => {
  it('never stores the password itself', async () => {
    const hash = await hashPassword('desk1234');
    expect(hash).not.toContain('desk1234');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('salts, so identical passwords hash differently', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('desk1234');
    expect(await verifyPassword('desk1234', hash)).toBe(true);
    expect(await verifyPassword('desk1235', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    expect(await verifyPassword('x', 'nonsense')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$abc$def')).toBe(false);
  });
});

describe('staff sessions', () => {
  it('round-trips a session through a signed token', async () => {
    const session = { userId: 'u1', email: 'desk@picklelounge.ph', name: 'Front Desk', role: 'STAFF' as const };
    const restored = await readSessionToken(await issueSession(session));
    expect(restored).toEqual(session);
  });

  it('rejects a tampered token', async () => {
    const token = await issueSession({ userId: 'u1', email: 'a@b.c', name: 'A', role: 'STAFF' });
    const [header, payload, signature] = token.split('.');
    // Re-sign is impossible without the secret; flipping the payload must fail.
    const forged = `${header}.${Buffer.from('{"sub":"u1","role":"ADMIN"}').toString('base64url')}.${signature}`;
    expect(await readSessionToken(forged)).toBeNull();
  });

  it('rejects junk', async () => {
    expect(await readSessionToken('')).toBeNull();
    expect(await readSessionToken('not.a.token')).toBeNull();
  });
});

describe('authenticate', () => {
  beforeEach(async () => {
    await prisma.staffUser.create({
      data: {
        email: 'desk@picklelounge.ph',
        name: 'Front Desk',
        role: 'STAFF',
        passwordHash: await hashPassword('desk1234'),
      },
    });
  });

  it('accepts correct credentials and records the sign-in', async () => {
    const session = await authenticate('desk@picklelounge.ph', 'desk1234');
    expect(session).toMatchObject({ email: 'desk@picklelounge.ph', role: 'STAFF' });
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'desk@picklelounge.ph' } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('is case-insensitive about the address', async () => {
    expect(await authenticate('  DESK@PickleLounge.PH ', 'desk1234')).not.toBeNull();
  });

  it('rejects a wrong password', async () => {
    expect(await authenticate('desk@picklelounge.ph', 'wrong')).toBeNull();
  });

  it('rejects an unknown address without revealing that it is unknown', async () => {
    expect(await authenticate('nobody@example.com', 'desk1234')).toBeNull();
  });
});

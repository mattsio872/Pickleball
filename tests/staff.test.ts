import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { createStaff, listStaff, removeStaff, updateStaff } from '@/lib/staff';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { migrateTestDatabase, resetDatabase } from './helpers';

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

let admin: { id: string };
let desk: { id: string };

beforeEach(async () => {
  await resetDatabase();
  admin = await prisma.staffUser.create({
    data: {
      email: 'admin@picklelounge.ph',
      name: 'Venue Admin',
      role: 'ADMIN',
      passwordHash: await hashPassword('admin-password'),
    },
  });
  desk = await prisma.staffUser.create({
    data: {
      email: 'desk@picklelounge.ph',
      name: 'Front Desk',
      role: 'STAFF',
      passwordHash: await hashPassword('desk-password'),
    },
  });
});

describe('creating staff', () => {
  it('creates an account with a hashed password', async () => {
    const created = await createStaff({
      email: 'newbie@picklelounge.ph',
      name: 'New Coach',
      role: 'STAFF',
      password: 'coach-password',
    });
    expect(created.role).toBe('STAFF');

    const row = await prisma.staffUser.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.passwordHash).not.toContain('coach-password');
    expect(await verifyPassword('coach-password', row.passwordHash)).toBe(true);
  });

  it('lowercases and trims the email', async () => {
    const created = await createStaff({
      email: '  Newbie@PickleLounge.PH ',
      name: 'New Coach',
      role: 'STAFF',
      password: 'coach-password',
    });
    expect(created.email).toBe('newbie@picklelounge.ph');
  });

  it('refuses a duplicate address', async () => {
    await expect(
      createStaff({ email: 'desk@picklelounge.ph', name: 'Impostor', role: 'ADMIN', password: 'password123' }),
    ).rejects.toThrow(/already has an account/);
  });

  it('refuses a short password', async () => {
    await expect(
      createStaff({ email: 'x@picklelounge.ph', name: 'X', role: 'STAFF', password: 'short' }),
    ).rejects.toThrow(ValidationError);
  });

  it('never returns the password hash', async () => {
    const created = await createStaff({
      email: 'newbie@picklelounge.ph',
      name: 'New Coach',
      role: 'STAFF',
      password: 'coach-password',
    });
    expect(created).not.toHaveProperty('passwordHash');
    const all = await listStaff();
    expect(all.every((s) => !('passwordHash' in s))).toBe(true);
  });
});

describe('updating staff', () => {
  it('promotes and demotes', async () => {
    const promoted = await updateStaff({ id: desk.id, role: 'ADMIN' });
    expect(promoted.role).toBe('ADMIN');
    const demoted = await updateStaff({ id: desk.id, role: 'STAFF' });
    expect(demoted.role).toBe('STAFF');
  });

  it('resets a password without needing the old one', async () => {
    await updateStaff({ id: desk.id, password: 'brand-new-password' });
    const row = await prisma.staffUser.findUniqueOrThrow({ where: { id: desk.id } });
    expect(await verifyPassword('brand-new-password', row.passwordHash)).toBe(true);
    expect(await verifyPassword('desk-password', row.passwordHash)).toBe(false);
  });

  it('refuses a short password on reset', async () => {
    await expect(updateStaff({ id: desk.id, password: 'short' })).rejects.toThrow(ValidationError);
  });

  it('reports an unknown account', async () => {
    await expect(updateStaff({ id: 'nope', name: 'Ghost' })).rejects.toThrow(NotFoundError);
  });
});

describe('the venue cannot lock itself out', () => {
  it('refuses to demote the only admin', async () => {
    await expect(updateStaff({ id: admin.id, role: 'STAFF' })).rejects.toThrow(/only admin account/);
    const row = await prisma.staffUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.role).toBe('ADMIN');
  });

  it('refuses to remove the only admin', async () => {
    await expect(removeStaff(admin.id, desk.id)).rejects.toThrow(/only admin account/);
    expect(await prisma.staffUser.count({ where: { role: 'ADMIN' } })).toBe(1);
  });

  it('allows demoting an admin once there is a second one', async () => {
    await updateStaff({ id: desk.id, role: 'ADMIN' });
    const demoted = await updateStaff({ id: admin.id, role: 'STAFF' });
    expect(demoted.role).toBe('STAFF');
    expect(await prisma.staffUser.count({ where: { role: 'ADMIN' } })).toBe(1);
  });

  it('allows removing an admin once there is a second one', async () => {
    const second = await createStaff({
      email: 'owner@picklelounge.ph',
      name: 'Owner',
      role: 'ADMIN',
      password: 'owner-password',
    });
    await removeStaff(admin.id, second.id);
    expect(await prisma.staffUser.count({ where: { role: 'ADMIN' } })).toBe(1);
  });

  it('refuses to remove the account doing the removing', async () => {
    await expect(removeStaff(admin.id, admin.id)).rejects.toThrow(/signed in with/);
  });

  it('lets an admin remove a non-admin freely', async () => {
    await removeStaff(desk.id, admin.id);
    expect(await prisma.staffUser.findUnique({ where: { id: desk.id } })).toBeNull();
  });

  it('reports an unknown account rather than deleting nothing quietly', async () => {
    await expect(removeStaff('nope', admin.id)).rejects.toThrow(NotFoundError);
  });
});

describe('duplicate detection elsewhere', () => {
  it('reports a duplicate court code rather than failing opaquely', async () => {
    // Same defect as the duplicate-email case: Prisma reports its own P2002,
    // never the Postgres SQLSTATE, so a check against 23505 alone never fired.
    const { isUniqueViolation } = await import('@/lib/db');
    await prisma.court.create({
      data: { code: 'A', name: 'Center', blurb: 'A court.', meta: 'Indoor' },
    });
    try {
      await prisma.court.create({
        data: { code: 'A', name: 'Duplicate', blurb: 'Another.', meta: 'Indoor' },
      });
      throw new Error('expected the second create to fail');
    } catch (error) {
      expect(isUniqueViolation(error)).toBe(true);
    }
  });
});

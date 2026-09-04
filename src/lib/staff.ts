import type { StaffRole } from '@prisma/client';
import { isUniqueViolation, prisma } from './db';
import { hashPassword } from './auth';
import { NotFoundError, ValidationError } from './errors';

/**
 * Staff account management.
 *
 * The rule running through every write: the venue must never be able to lock
 * itself out. Removing the last admin, demoting the last admin, or removing
 * the account you are signed in with are all refused, because recovering from
 * any of them means editing the database by hand.
 *
 * Kept out of the route handlers so those rules can be tested directly rather
 * than through HTTP and a session cookie.
 */

export type StaffView = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const VIEW = { id: true, email: true, name: true, role: true, lastLoginAt: true, createdAt: true } as const;

export const MIN_PASSWORD_LENGTH = 8;

export async function listStaff(): Promise<StaffView[]> {
  return prisma.staffUser.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }], select: VIEW });
}

export async function createStaff(input: {
  email: string;
  name: string;
  role: StaffRole;
  password: string;
}): Promise<StaffView> {
  assertPasswordLength(input.password);
  try {
    return await prisma.staffUser.create({
      data: {
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        role: input.role,
        passwordHash: await hashPassword(input.password),
      },
      select: VIEW,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError(`${input.email.trim().toLowerCase()} already has an account.`);
    }
    throw error;
  }
}

export async function updateStaff(input: {
  id: string;
  name?: string;
  role?: StaffRole;
  password?: string;
}): Promise<StaffView> {
  const target = await prisma.staffUser.findUnique({ where: { id: input.id } });
  if (!target) throw new NotFoundError('No such staff account.');

  if (input.password) assertPasswordLength(input.password);

  if (input.role === 'STAFF' && target.role === 'ADMIN') {
    await assertNotLastAdmin(target.id, 'demote');
  }

  return prisma.staffUser.update({
    where: { id: input.id },
    data: {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    },
    select: VIEW,
  });
}

export async function removeStaff(id: string, actingUserId: string): Promise<{ removed: string }> {
  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target) throw new NotFoundError('No such staff account.');

  if (target.id === actingUserId) {
    throw new ValidationError('You cannot remove the account you are signed in with.');
  }
  await assertNotLastAdmin(id, 'remove');

  await prisma.staffUser.delete({ where: { id } });
  return { removed: target.email };
}

function assertPasswordLength(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

async function assertNotLastAdmin(userId: string, action: 'remove' | 'demote') {
  const target = await prisma.staffUser.findUnique({ where: { id: userId } });
  if (target?.role !== 'ADMIN') return;

  const admins = await prisma.staffUser.count({ where: { role: 'ADMIN' } });
  if (admins > 1) return;

  throw new ValidationError(
    action === 'remove'
      ? 'This is the only admin account. Promote somebody else before removing it, or nobody could reach the admin screens again.'
      : 'This is the only admin account. Promote somebody else before changing this one to staff.',
  );
}

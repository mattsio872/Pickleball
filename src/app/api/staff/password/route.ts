import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, hashPassword, requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { AuthError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(8, 'Use at least 8 characters.').max(200),
});

/**
 * Changing your own password.
 *
 * Available to every signed-in staff member, admin or not — the alternative
 * was a command-line script run from a clone of the repository, which is not a
 * thing a front desk can be asked to do.
 *
 * The current password is required even though the session already proves who
 * you are: it means an unattended, still-signed-in browser cannot be used to
 * take the account over.
 */
export const POST = route(async (request: NextRequest) => {
  const session = await requireStaff();
  const input = body.parse(await request.json());

  const confirmed = await authenticate(session.email, input.currentPassword);
  if (!confirmed) throw new AuthError('That is not your current password.');

  if (input.newPassword === input.currentPassword) {
    throw new ValidationError('The new password is the same as the current one.');
  }

  await prisma.staffUser.update({
    where: { id: session.userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  return NextResponse.json({ ok: true });
});

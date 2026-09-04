import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomer } from '@/lib/customer-auth';
import { authenticateCustomer } from '@/lib/customer-auth';
import { hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { AuthError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  name: z.string().trim().min(2, 'Please give your name.').max(120).optional(),
  mobile: z
    .string()
    .trim()
    .min(7, 'Please give a contactable mobile number.')
    .max(30)
    .regex(/^[0-9+()\-\s]+$/, 'Use digits, spaces, +, - and () only.')
    .optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Use at least 8 characters.').max(200).optional(),
});

/** Saved details, and the customer's own password. */
export const PATCH = route(async (request: NextRequest) => {
  const session = await requireCustomer();
  const input = body.parse(await request.json());

  if (input.newPassword) {
    // Same reasoning as the staff form: a session alone must not be enough to
    // change the password on an unattended browser.
    if (!input.currentPassword) throw new ValidationError('Enter your current password to change it.');
    const confirmed = await authenticateCustomer(session.email, input.currentPassword);
    if (!confirmed) throw new AuthError('That is not your current password.');
  }

  const customer = await prisma.customer.update({
    where: { id: session.customerId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.mobile ? { mobile: input.mobile } : {}),
      ...(input.newPassword ? { passwordHash: await hashPassword(input.newPassword) } : {}),
    },
    select: { name: true, email: true, mobile: true },
  });

  return NextResponse.json(customer);
});

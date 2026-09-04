import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { createStaff, listStaff, removeStaff, updateStaff } from '@/lib/staff';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Staff accounts. Admin only; the rules live in src/lib/staff.ts. */

export const GET = route(async () => {
  await requireAdmin();
  return NextResponse.json({ staff: await listStaff() });
});

const create = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address.').max(200),
  name: z.string().trim().min(2, 'Give them a name.').max(120),
  role: z.enum(['STAFF', 'ADMIN']),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export const POST = route(async (request: NextRequest) => {
  await requireAdmin();
  const input = create.parse(await request.json());
  return NextResponse.json(await createStaff(input), { status: 201 });
});

const update = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['STAFF', 'ADMIN']).optional(),
  /** Set by an admin resetting somebody else's forgotten password. */
  password: z.string().min(8, 'Use at least 8 characters.').max(200).optional(),
});

export const PATCH = route(async (request: NextRequest) => {
  const session = await requireAdmin();
  const input = update.parse(await request.json());
  const user = await updateStaff(input);
  // The browser holds a session naming the old role; it needs to re-read it.
  return NextResponse.json({ ...user, selfChanged: user.id === session.userId });
});

export const DELETE = route(async (request: NextRequest) => {
  const session = await requireAdmin();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) throw new ValidationError('Which account?');
  return NextResponse.json({ ok: true, ...(await removeStaff(id, session.userId)) });
});

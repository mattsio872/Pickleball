import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db';
import { route } from '@/lib/api';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const create = z.object({
  code: z.string().trim().min(1).max(4).regex(/^[A-Za-z0-9]+$/, 'Letters and digits only.'),
  name: z.string().trim().min(1).max(60),
  blurb: z.string().trim().max(300),
  meta: z.string().trim().max(120),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Give a full image URL, or leave it blank.')
    .optional(),
  sortOrder: z.number().int().min(0).max(99).optional(),
});

export const POST = route(async (request: NextRequest) => {
  await requireAdmin();
  const input = create.parse(await request.json());
  try {
    const court = await prisma.court.create({
      data: { ...input, code: input.code.toUpperCase(), sortOrder: input.sortOrder ?? 0 },
    });
    return NextResponse.json(court, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError(`Court ${input.code.toUpperCase()} already exists.`);
    }
    throw error;
  }
});

const update = create.partial().extend({ id: z.string().min(1), active: z.boolean().optional() });

export const PATCH = route(async (request: NextRequest) => {
  await requireAdmin();
  const { id, ...rest } = update.parse(await request.json());

  const existing = await prisma.court.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('No such court.');

  // Retiring a court must not strand bookings that have already been paid for.
  if (rest.active === false) {
    const upcoming = await prisma.booking.count({
      where: { courtId: id, status: 'CONFIRMED', endsAt: { gt: new Date() } },
    });
    if (upcoming > 0) {
      throw new ValidationError(
        `Court ${existing.code} still has ${upcoming} confirmed booking${upcoming === 1 ? '' : 's'} ahead of it. ` +
          'Close it for a date range instead, or move those bookings first.',
      );
    }
  }

  const court = await prisma.court.update({
    where: { id },
    data: { ...rest, ...(rest.code ? { code: rest.code.toUpperCase() } : {}) },
  });
  return NextResponse.json(court);
});

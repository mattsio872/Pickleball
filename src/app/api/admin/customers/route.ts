import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { customerHistory, listCustomers } from '@/lib/customers';
import { getSettings } from '@/lib/settings';
import { slotLabel } from '@/lib/time';
import { route } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The customer directory, or one customer's booking history when `email` is
 * given. Admin only — it exposes every booker's contact details in one place.
 */
export const GET = route(async (request: NextRequest) => {
  await requireAdmin();
  const params = request.nextUrl.searchParams;
  const email = params.get('email');

  if (email) {
    const settings = await getSettings();
    const bookings = await customerHistory(email);
    return NextResponse.json({
      email: email.toLowerCase(),
      bookings: bookings.map((b) => ({
        ref: b.ref,
        status: b.status,
        court: `Court ${b.court.code} · ${b.court.name}`,
        slot: slotLabel(b.startsAt, b.endsAt, settings.timezone),
        startsAt: b.startsAt.toISOString(),
        totalCents: b.totalCents,
        players: b.players.length,
        name: b.customerName,
        mobile: b.customerMobile,
      })),
    });
  }

  return NextResponse.json(
    await listCustomers({ search: params.get('q') ?? undefined, limit: 200 }),
  );
});

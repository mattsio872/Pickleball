import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-auth';
import { prisma } from '@/lib/db';
import { isDayKey } from '@/lib/time';
import { SiteHeader } from '@/components/SiteHeader';
import { BookingFlow } from '@/components/BookingFlow';

export const dynamic = 'force-dynamic';

/**
 * Anyone may look; only an account may book.
 *
 * The gate used to sit on this page, which meant a visitor could not see a
 * single free hour without first making an account — the one question a venue
 * is asked more than any other, behind a password. The account is now asked for
 * where it is genuinely needed, at payment, and the API refuses a hold without
 * one in any case. What survives sign-in is the slot: the chosen day, court,
 * time and length come back through the query string so nobody picks twice.
 */
function number(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    cancelled?: string;
    date?: string;
    court?: string;
    start?: string;
    duration?: string;
  }>;
}) {
  const { cancelled, date, court, start, duration } = await searchParams;

  const settings = await getSettings();
  const customer = await currentCustomer();
  const profile = customer
    ? await prisma.customer.findUnique({
        where: { id: customer.customerId },
        select: { name: true, mobile: true },
      })
    : null;

  return (
    <>
      <SiteHeader
        venueName={settings.venueName}
        city={settings.city}
        showNav={false}
        customerName={customer?.name}
      />
      <BookingFlow
        cancelledRef={cancelled}
        account={
          customer
            ? {
                name: profile?.name ?? customer.name,
                email: customer.email,
                mobile: profile?.mobile ?? '',
              }
            : null
        }
        initial={{
          dayKey: date && isDayKey(date) ? date : undefined,
          courtId: court,
          startMinutes: number(start),
          durationMinutes: number(duration),
        }}
      />
    </>
  );
}

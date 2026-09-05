import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-auth';
import { prisma } from '@/lib/db';
import { SiteHeader } from '@/components/SiteHeader';
import { BookingFlow } from '@/components/BookingFlow';

export const dynamic = 'force-dynamic';

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { cancelled } = await searchParams;

  // Booking is account-only, so the sign-in screen comes first and hands the
  // booker straight back here. The API enforces the same rule; this exists so
  // nobody picks a slot before finding out.
  const customer = await currentCustomer();
  if (!customer) {
    const next = cancelled ? `/book?cancelled=${encodeURIComponent(cancelled)}` : '/book';
    redirect(`/signin?next=${encodeURIComponent(next)}`);
  }

  const settings = await getSettings();
  const profile = await prisma.customer.findUnique({
    where: { id: customer.customerId },
    select: { name: true, mobile: true },
  });

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} customerName={customer.name} />
      <BookingFlow
        cancelledRef={cancelled}
        account={{
          name: profile?.name ?? customer.name,
          email: customer.email,
          mobile: profile?.mobile ?? '',
        }}
      />
    </>
  );
}

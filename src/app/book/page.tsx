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
  const settings = await getSettings();
  const customer = await currentCustomer();
  const profile = customer
    ? await prisma.customer.findUnique({
        where: { id: customer.customerId },
        select: { name: true, mobile: true },
      })
    : null;
  const { cancelled } = await searchParams;

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} customerName={customer?.name} />
      <BookingFlow
        cancelledRef={cancelled}
        savedDetails={
          customer
            ? { name: profile?.name ?? customer.name, email: customer.email, mobile: profile?.mobile ?? '' }
            : undefined
        }
      />
    </>
  );
}

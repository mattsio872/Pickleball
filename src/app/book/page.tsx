import { getSettings } from '@/lib/settings';
import { SiteHeader } from '@/components/SiteHeader';
import { BookingFlow } from '@/components/BookingFlow';

export const dynamic = 'force-dynamic';

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const settings = await getSettings();
  const { cancelled } = await searchParams;

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} showNav={false} />
      <BookingFlow cancelledRef={cancelled} />
    </>
  );
}

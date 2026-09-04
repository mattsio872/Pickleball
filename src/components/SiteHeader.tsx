import Link from 'next/link';

/** The sticky header from the design, shared by every public page. */
export function SiteHeader({
  venueName,
  city,
  showNav = true,
  customerName,
}: {
  venueName: string;
  city: string;
  showNav?: boolean;
  /** The signed-in customer, when there is one. */
  customerName?: string | null;
}) {
  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="brand">
          {venueName} <span>· {city}</span>
        </Link>
        <nav className="site-nav site-nav-public">
          {showNav && (
            <>
              <Link href="/#courts">Courts</Link>
              <Link href="/#rates">Rates</Link>
              <Link href="/#faq">FAQ</Link>
            </>
          )}
          {customerName ? (
            <Link href="/my">{customerName.split(' ')[0]}&rsquo;s bookings</Link>
          ) : (
            <Link href="/signin">Sign in</Link>
          )}
          <Link className="btn btn-primary" href="/book">
            Book a court
          </Link>
        </nav>
      </div>
    </header>
  );
}

import Link from 'next/link';

/** The sticky header from the design, shared by every public page. */
export function SiteHeader({
  venueName,
  city,
  showNav = true,
}: {
  venueName: string;
  city: string;
  showNav?: boolean;
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
          <Link className="btn btn-primary" href="/book">
            Book a court
          </Link>
        </nav>
      </div>
    </header>
  );
}

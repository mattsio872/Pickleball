'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * The sticky header from the design, shared by every public page.
 *
 * The design's header is a single row of links, which is right on a laptop and
 * impossible on a phone: the links used to be hidden outright below 640px, so
 * Courts, Rates, FAQ and — worse — Sign in simply did not exist on the device
 * most people book from. They now fold into a menu instead of disappearing.
 * The primary action stays in the bar at every width; a phone should never need
 * two taps to book a court.
 */
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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="brand" onClick={close}>
          {venueName} <span>· {city}</span>
        </Link>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="nav-toggle-bars" data-open={open} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Menu
        </button>

        <nav className="site-nav site-nav-public" id="site-menu" data-open={open}>
          {showNav && (
            <>
              <Link href="/#courts" onClick={close}>
                Courts
              </Link>
              <Link href="/#rates" onClick={close}>
                Rates
              </Link>
              <Link href="/#faq" onClick={close}>
                FAQ
              </Link>
            </>
          )}
          {customerName ? (
            <Link href="/my" onClick={close}>
              {customerName.split(' ')[0]}&rsquo;s bookings
            </Link>
          ) : (
            <Link href="/signin" onClick={close}>
              Sign in
            </Link>
          )}
          <Link className="btn btn-primary" href="/book" onClick={close}>
            Book a court
          </Link>
        </nav>
      </div>
    </header>
  );
}

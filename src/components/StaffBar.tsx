'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Header for the staff-only screens.
 *
 * Three things were competing here: the brand, a "View site" button and a
 * "Leave staff view" link at the foot of the page all did the same thing, while
 * the signed-in person's name sat in the row of sections looking like another
 * one — "Venue Admin" next to "Admin" being the worst of it. Now there is one
 * way back to the public site, the sections are named for what they open, and
 * the account sits apart from them, labelled as a person.
 */
const SECTIONS = [
  { href: '/desk', label: 'Front desk', match: (p: string) => p === '/desk' || p.startsWith('/desk/verify') },
  { href: '/desk/bookings', label: 'Bookings', match: (p: string) => p.startsWith('/desk/bookings') },
  { href: '/admin/schedule', label: 'Schedule', match: (p: string) => p.startsWith('/admin/schedule') },
] as const;

export function StaffBar({
  venueName,
  staffName,
  role,
}: {
  venueName: string;
  staffName: string;
  role: 'STAFF' | 'ADMIN';
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/desk" className="brand brand-staff" title="Front desk">
          {venueName} <span>· staff</span>
        </Link>
        <nav className="site-nav site-nav-staff">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={section.match(pathname) ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
          {role === 'ADMIN' && (
            <Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined}>
              Venue settings
            </Link>
          )}

          <span className="staff-who">
            <Link href="/account" title="Your account and password">
              {staffName}
            </Link>
          </span>
          <Link className="btn btn-secondary" href="/" title="Open the customer-facing site">
            View site
          </Link>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await fetch('/api/staff/logout', { method: 'POST' });
              router.push('/desk/login');
              router.refresh();
            }}
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}

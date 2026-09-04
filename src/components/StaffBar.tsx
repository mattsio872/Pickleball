'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Header for the staff-only screens.
 *
 * The venue name goes to the public site, as it does on every other page —
 * staff otherwise had no route out of the dashboard at all — and "Front desk"
 * covers the navigation the brand used to do.
 */
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

  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="brand" title="Back to the public site">
          {venueName} <span>· staff</span>
        </Link>
        <nav className="site-nav site-nav-staff">
          <Link href="/desk">Front desk</Link>
          {role === 'ADMIN' && <Link href="/admin">Admin</Link>}
          <Link href="/account">{staffName}</Link>
          <Link href="/" className="btn btn-secondary">
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

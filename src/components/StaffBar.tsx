'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Header for the staff-only screens, with the sign-out control. */
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
        <Link href="/desk" className="brand">
          {venueName} <span>· staff</span>
        </Link>
        <nav className="site-nav" style={{ gap: 16 }}>
          <Link href="/desk">Front desk</Link>
          {role === 'ADMIN' && <Link href="/admin">Admin</Link>}
          <Link href="/account" style={{ fontSize: 13 }}>
            {staffName}
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

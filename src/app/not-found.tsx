import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Not found
        </div>
        <h3 style={{ marginBottom: 10 }}>That link doesn&rsquo;t lead anywhere.</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 22 }}>
          A pass link may have been mistyped, or the booking it pointed to no longer exists.
        </p>
        <Link className="btn btn-primary" href="/">
          Back to the site
        </Link>
      </div>
    </main>
  );
}

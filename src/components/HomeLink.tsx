import Link from 'next/link';

/**
 * A way back to the public site.
 *
 * Every screen needs one. The staff screens and the checkout hand-off used to
 * be dead ends — the sign-in page most of all, which is where signing out
 * leaves you, with nothing on it but a form for credentials you have just
 * stopped having.
 */
export function HomeLink({
  label = 'Back to the site',
  className = 'btn btn-ghost',
  style,
}: {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Link href="/" className={className} style={style}>
      <span aria-hidden="true">←</span> {label}
    </Link>
  );
}

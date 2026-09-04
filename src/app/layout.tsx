import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pickle Lounge — book an indoor pickleball court',
  description:
    'Reserve one of three indoor courts in Quezon City, pay by GCash, Maya or online bank transfer, and walk in with a QR pass the front desk scans on arrival.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fbfafc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

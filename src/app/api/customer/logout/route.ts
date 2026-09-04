import { NextResponse } from 'next/server';
import { CUSTOMER_COOKIE } from '@/lib/customer-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CUSTOMER_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

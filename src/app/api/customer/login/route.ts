import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateCustomer,
  CUSTOMER_COOKIE,
  customerCookieOptions,
  issueCustomerSession,
} from '@/lib/customer-auth';
import { route } from '@/lib/api';
import { AuthError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  email: z.string().trim().email('Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const POST = route(async (request: NextRequest) => {
  const input = body.parse(await request.json());
  const session = await authenticateCustomer(input.email, input.password);

  // One message for a wrong password and an unknown address alike, so the form
  // cannot be used to find out who has an account here.
  if (!session) throw new AuthError('That email and password do not match.');

  const response = NextResponse.json({ name: session.name, email: session.email });
  response.cookies.set(CUSTOMER_COOKIE, await issueCustomerSession(session), customerCookieOptions());
  return response;
});

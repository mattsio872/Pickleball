import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CUSTOMER_COOKIE,
  customerCookieOptions,
  issueCustomerSession,
  registerCustomer,
} from '@/lib/customer-auth';
import { route } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  name: z.string().trim().min(2, 'Please give your name.').max(120),
  email: z.string().trim().email('That does not look like an email address.').max(200),
  mobile: z
    .string()
    .trim()
    .min(7, 'Please give a contactable mobile number.')
    .max(30)
    .regex(/^[0-9+()\-\s]+$/, 'Use digits, spaces, +, - and () only.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export const POST = route(async (request: NextRequest) => {
  const input = body.parse(await request.json());
  const session = await registerCustomer(input);

  const response = NextResponse.json({ name: session.name, email: session.email }, { status: 201 });
  response.cookies.set(CUSTOMER_COOKIE, await issueCustomerSession(session), customerCookieOptions());
  return response;
});

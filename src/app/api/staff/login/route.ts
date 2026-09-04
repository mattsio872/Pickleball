import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, issueSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';
import { route } from '@/lib/api';
import { AuthError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  email: z.string().trim().email('Enter your work email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const POST = route(async (request: NextRequest) => {
  const input = body.parse(await request.json());
  const session = await authenticate(input.email, input.password);

  // One message for both a wrong password and an unknown address, so the form
  // cannot be used to enumerate staff accounts.
  if (!session) throw new AuthError('That email and password do not match.');

  const response = NextResponse.json({ name: session.name, role: session.role });
  response.cookies.set(SESSION_COOKIE, await issueSession(session), sessionCookieOptions());
  return response;
});

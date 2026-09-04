import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { emailLive, env, paymentsLive, siteUrl } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Whether this deployment is actually able to work.
 *
 * Exists because the alternative is reading a hosting provider's build logs to
 * find out that a variable is blank. It reports the *names* of missing
 * settings and never their values, and says nothing that is not already
 * apparent from using the site — a deployment that cannot sign a session
 * cannot be signed into either.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;

  // Configuration.
  try {
    env();
    checks.configuration = { ok: true };
  } catch (error) {
    ok = false;
    checks.configuration =
      error instanceof ConfigurationError
        ? {
            ok: false,
            missing: error.missing,
            hint: 'Set these in your host\'s environment variables and redeploy. APP_SECRET must be 32+ characters.',
          }
        : { ok: false, hint: 'Configuration could not be read.' };
  }

  // Database, and whether it has been seeded.
  try {
    const [courts, staff, settings] = await Promise.all([
      prisma.court.count(),
      prisma.staffUser.count(),
      prisma.settings.count(),
    ]);
    const seeded = courts > 0 && staff > 0 && settings > 0;
    if (!seeded) ok = false;
    checks.database = {
      ok: true,
      seeded,
      courts,
      staffAccounts: staff,
      ...(seeded ? {} : { hint: 'Run `npm run db:seed` against this database — see the README.' }),
    };
  } catch {
    ok = false;
    checks.database = {
      ok: false,
      hint: 'Could not reach the database. Check DATABASE_URL, and that migrations have run.',
    };
  }

  // Optional integrations. Absent is a valid state, not a failure.
  try {
    checks.payments = paymentsLive()
      ? { mode: 'paymongo' }
      : { mode: 'sandbox', note: 'No PAYMONGO_SECRET_KEY — bookings confirm without money moving.' };
    checks.email = emailLive()
      ? { mode: 'resend' }
      : { mode: 'console', note: 'No RESEND_API_KEY — passes are logged, not emailed.' };
    checks.siteUrl = siteUrl();
  } catch {
    // Already reported by the configuration check above.
  }

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}

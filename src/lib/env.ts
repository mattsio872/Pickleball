import { z } from 'zod';
import { ConfigurationError } from './errors';

/**
 * Server-side configuration.
 *
 * Validation is deliberately *lazy*. Next.js imports every route module during
 * the build to read its config exports, so validating at import time makes the
 * secrets a build-time requirement — a deploy without them dies with
 * "Failed to collect page data for /api/admin/closures", which names a route
 * that has nothing to do with the problem. Resolving on first use instead means
 * the build only needs code, while the running app still refuses to start
 * serving with a bad configuration, and says so in terms of the variable.
 *
 * Payment and email credentials are optional on purpose: the app degrades to a
 * sandbox gateway and a console mailer when they are absent, so the whole
 * booking flow can be exercised before any account exists. What is *not*
 * optional is APP_SECRET — it signs entry passes and staff sessions, and a weak
 * one would let anyone mint a valid pass.
 */
/**
 * An unset variable and one set to an empty string mean the same thing — a
 * hosting dashboard makes it very easy to create the latter — so blanks are
 * normalised away before validation rather than failing as "invalid".
 */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().optional());

/**
 * A public origin, accepting what people actually paste.
 *
 * A hosting dashboard shows the domain as `example.vercel.app`, so that is what
 * gets copied in. Rejecting it for lacking a scheme is pedantry when the intent
 * is unambiguous; it is upgraded to https instead.
 */
const originUrl = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url('Must be a URL or a hostname, e.g. https://picklelounge.ph').optional());

const schema = z.object({
  DATABASE_URL: z.preprocess(
    blankToUndefined,
    z.string({ required_error: 'Required — the Postgres connection string.' }).min(1),
  ),
  APP_SECRET: z.preprocess(
    blankToUndefined,
    z
      .string({ required_error: 'Required — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' })
      .min(32, 'Must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
  ),
  NEXT_PUBLIC_SITE_URL: originUrl,
  // Set by Vercel. VERCEL_PROJECT_PRODUCTION_URL is the stable production
  // domain; VERCEL_URL is unique per deployment and covers preview builds.
  VERCEL_PROJECT_PRODUCTION_URL: optionalText,
  VERCEL_URL: optionalText,

  PAYMONGO_SECRET_KEY: optionalText.pipe(z.string().optional().default('')),
  PAYMONGO_PUBLIC_KEY: optionalText.pipe(z.string().optional().default('')),
  PAYMONGO_WEBHOOK_SECRET: optionalText.pipe(z.string().optional().default('')),

  RESEND_API_KEY: optionalText.pipe(z.string().optional().default('')),
  EMAIL_FROM: optionalText.pipe(
    z.string().optional().default('Pickle Lounge <onboarding@resend.dev>'),
  ),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated configuration, resolved and memoised on first use. */
export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // "Missing" and "set to something wrong" need different fixes, and saying
    // "missing" about a variable that is plainly present in the dashboard sends
    // people looking in the wrong place.
    const problems = [...new Map(
      parsed.error.issues.map((issue) => {
        const name = String(issue.path[0]);
        const raw = process.env[name];
        return [name, { name, present: raw !== undefined && raw.trim() !== '', message: issue.message }];
      }),
    ).values()];

    const issues = problems
      .map((p) => `  • ${p.name}: ${p.present ? 'set, but rejected — ' : ''}${p.message}`)
      .join('\n');

    throw new ConfigurationError(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Set these where the app runs — locally in .env (copy .env.example), or in your ' +
        "host's environment variables. See the README.",
      problems,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Discards the memoised configuration. Exists for the tests. */
export function resetEnvCache(): void {
  cached = null;
}

/** True when real PayMongo credentials are present; otherwise the sandbox gateway runs. */
export function paymentsLive(): boolean {
  return Boolean(env().PAYMONGO_SECRET_KEY);
}

/** True when Resend is configured; otherwise passes are logged, not sent. */
export function emailLive(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

/**
 * The public origin. Pass links, join links and the payment provider's redirect
 * URLs are all built from it, so getting it wrong mints passes that point
 * somewhere the customer cannot reach.
 *
 * It is resolved rather than merely read because of a first-deploy
 * chicken-and-egg: you do not know your domain until after the deploy that
 * needs it. On Vercel the platform supplies one, so an unset variable falls
 * back to the production domain (or the per-deployment URL on a preview build)
 * instead of quietly issuing passes that link to localhost. Setting
 * NEXT_PUBLIC_SITE_URL explicitly always wins — a custom domain must be stated,
 * since Vercel keeps reporting its own .vercel.app hostname.
 */
export function siteUrl(): string {
  const config = env();
  if (config.NEXT_PUBLIC_SITE_URL) return config.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  const vercelHost = config.VERCEL_PROJECT_PRODUCTION_URL || config.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  return 'http://localhost:3000';
}

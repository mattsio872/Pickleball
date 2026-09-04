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
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'Required — the Postgres connection string.'),
  APP_SECRET: z
    .string({ required_error: 'Required — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' })
    .min(32, 'Must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  // Set by Vercel. VERCEL_PROJECT_PRODUCTION_URL is the stable production
  // domain; VERCEL_URL is unique per deployment and covers preview builds.
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),

  PAYMONGO_SECRET_KEY: z.string().optional().default(''),
  PAYMONGO_PUBLIC_KEY: z.string().optional().default(''),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional().default(''),

  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('Pickle Lounge <onboarding@resend.dev>'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated configuration, resolved and memoised on first use. */
export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigurationError(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Set these where the app runs — locally in .env (copy .env.example), or in your ' +
        "host's environment variables. See the README.",
      missing,
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

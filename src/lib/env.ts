import { z } from 'zod';

/**
 * Server-side configuration, validated once at import.
 *
 * Payment and email credentials are optional on purpose: the app degrades to a
 * sandbox gateway and a console mailer when they are absent, so the whole
 * booking flow can be exercised end to end before any account exists. What is
 * *not* optional is APP_SECRET — it signs entry passes and staff sessions, and
 * a weak one would let anyone mint a valid pass.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_SECRET: z
    .string()
    .min(32, 'APP_SECRET must be at least 32 characters — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
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

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}

export const env = load();

/** True when real PayMongo credentials are present; otherwise the sandbox gateway runs. */
export const paymentsLive = Boolean(env.PAYMONGO_SECRET_KEY);

/** True when Resend is configured; otherwise passes are logged, not sent. */
export const emailLive = Boolean(env.RESEND_API_KEY);

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
function resolveSiteUrl(): string {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  return 'http://localhost:3000';
}

export const siteUrl = resolveSiteUrl();

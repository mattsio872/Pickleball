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
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),

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

export const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

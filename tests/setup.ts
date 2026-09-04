/**
 * Test bootstrap.
 *
 * Integration tests run against a real Postgres database — the same engine as
 * production, because the no-double-booking guarantee is an EXCLUDE constraint
 * and a fake database would not have one to violate.
 */
import { config } from 'dotenv';

config({ path: '.env' });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Point it at a scratch database — the tests truncate its tables.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.NEXT_PUBLIC_SITE_URL ||= 'http://localhost:3000';
// Force the sandbox gateway and the console mailer regardless of local .env.
process.env.PAYMONGO_SECRET_KEY = '';
process.env.RESEND_API_KEY = '';

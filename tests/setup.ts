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
/**
 * The tests truncate every table they touch, so the one thing that must never
 * happen is pointing them at a database somebody is using. Catching it here
 * costs a line; discovering it afterwards costs the data — as it did during
 * this audit, when a test run emptied the staff accounts out from under a
 * running dev server because both variables named the same database.
 */
if (process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is the same database as DATABASE_URL. The tests truncate every table ' +
      'they touch — point TEST_DATABASE_URL at a separate scratch database.',
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.NEXT_PUBLIC_SITE_URL ||= 'http://localhost:3000';
// Force the sandbox gateway and the console mailer regardless of local .env.
process.env.PAYMONGO_SECRET_KEY = '';
process.env.RESEND_API_KEY = '';

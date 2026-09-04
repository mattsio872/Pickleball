/**
 * Checks DATABASE_URL before a script tries to connect with it.
 *
 * Prisma's own failure for a bad string is "Authentication failed ... for
 * `(not available)`", which says nothing about *why*. The two mistakes that
 * actually happen are pasting a documentation placeholder verbatim, and
 * pasting a string whose password was masked for sharing — both produce a
 * well-formed URL that simply cannot authenticate. Naming that here turns a
 * confusing failure into an obvious one.
 */

/** Fragments that mean the string was never filled in, or was masked to share. */
const PLACEHOLDER_PATTERNS: { pattern: RegExp; explanation: string }[] = [
  { pattern: /\*{3,}/, explanation: 'the password is a row of asterisks — this string was masked for sharing, not a real one' },
  { pattern: /[<>]/, explanation: 'it still contains angle brackets, so a placeholder was pasted verbatim' },
  { pattern: /YOUR[_-]?ACTUAL/i, explanation: 'it still contains a "YOUR_ACTUAL_..." placeholder' },
  { pattern: /\bconnection[_ -]?string\b/i, explanation: 'it contains the words "connection string" rather than an actual one' },
  { pattern: /\byour[_-]/i, explanation: 'it still contains a "your-..." placeholder' },
];

/** The URL with its password replaced, safe to print or share. */
export function maskDatabaseUrl(url: string): string {
  return url.replace(/(:\/\/[^:/@]+:)[^@]*(@)/, '$1***$2');
}

export function assertUsableDatabaseUrl(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    fail(
      'DATABASE_URL is not set.',
      'macOS/Linux:  DATABASE_URL="postgresql://..." npm run <script>',
      'PowerShell:   $env:DATABASE_URL="postgresql://..."',
    );
  }

  if (!/^postgres(ql)?:\/\//.test(url)) {
    fail(
      'DATABASE_URL does not look like a Postgres connection string.',
      'It must begin with postgresql:// or postgres://',
      `Got: ${url.slice(0, 24)}${url.length > 24 ? '…' : ''}`,
    );
  }

  for (const { pattern, explanation } of PLACEHOLDER_PATTERNS) {
    if (pattern.test(url)) {
      fail(
        `DATABASE_URL is not a usable connection string — ${explanation}.`,
        'Copy the real string from the Neon console (Connect → the panel shows it in full),',
        'and paste it exactly. Only mask the password when showing the command to someone else,',
        'never when actually running it.',
        '',
        `Currently set to: ${maskDatabaseUrl(url)}`,
      );
    }
  }
}

function fail(...lines: string[]): never {
  console.error('');
  for (const line of lines) console.error(line);
  console.error('');
  process.exit(1);
}

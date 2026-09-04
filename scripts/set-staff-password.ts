/**
 * Sets a staff member's password.
 *
 * The seed never overwrites an existing account — which is what makes
 * re-seeding safe, but also means a password chosen badly at seed time cannot
 * be fixed by seeding again. This is the way to change one.
 *
 *   npm run staff:password -- admin@picklelounge.ph
 *
 * The password is prompted for rather than passed as an argument, so it does
 * not end up in shell history or the process list. Set STAFF_PASSWORD instead
 * when scripting.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth';

const prisma = new PrismaClient();

/**
 * Reads a password without echoing it.
 *
 * Raw mode rather than readline's private `_writeToOutput` hook: that hook is
 * an implementation detail and does not mask reliably on Windows terminals,
 * where failing open means printing the password to the screen. Reading key by
 * key masks the same way everywhere.
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;

    if (!stdin.isTTY) {
      reject(
        new Error(
          'No interactive terminal, so the password cannot be prompted for safely.\n' +
            'Set STAFF_PASSWORD in the environment instead.',
        ),
      );
      return;
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    const done = (result: string | null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (result === null) {
        reject(new Error('Cancelled.'));
      } else {
        resolve(result);
      }
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        switch (char) {
          case '\r':
          case '\n':
          case '\u0004': // Ctrl-D
            done(value);
            return;
          case '\u0003': // Ctrl-C
            done(null);
            return;
          case '\u007f': // Backspace
          case '\b':
            if (value.length > 0) {
              value = value.slice(0, -1);
              stdout.write('\b \b');
            }
            break;
          default:
            // Ignore other control characters rather than storing them.
            if (char >= ' ') {
              value += char;
              stdout.write('*');
            }
        }
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Which account? e.g. npm run staff:password -- admin@picklelounge.ph');
    console.error('');
    const all = await prisma.staffUser.findMany({ orderBy: { email: 'asc' } });
    if (all.length > 0) {
      console.error('Staff accounts in this database:');
      for (const u of all) console.error(`  ${u.email}  (${u.role})`);
    }
    process.exit(1);
  }

  const user = await prisma.staffUser.findUnique({ where: { email } });
  if (!user) {
    console.error(`No staff account for ${email}.`);
    process.exit(1);
  }

  const password = process.env.STAFF_PASSWORD ?? (await promptHidden(`New password for ${email}: `));

  if (password.length < 8) {
    console.error('Too short — use at least 8 characters.');
    process.exit(1);
  }

  await prisma.staffUser.update({
    where: { email },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`Password updated for ${email} (${user.role}).`);
  console.log('Any existing sessions stay valid until they expire; sign out to end one now.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

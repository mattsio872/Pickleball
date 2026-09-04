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
import { createInterface } from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth';

const prisma = new PrismaClient();

/** Reads a line without echoing it to the terminal. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
    let muted = false;
    output._writeToOutput = (chunk: string) => {
      if (!muted) output.output.write(chunk);
    };
    rl.question(question, (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
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

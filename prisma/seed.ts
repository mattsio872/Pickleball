import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth';

/**
 * Seeds the three courts from the design, the venue defaults, and two staff
 * accounts so the desk and admin screens can be opened immediately.
 *
 * Idempotent: safe to run against a database that already has data.
 */
const prisma = new PrismaClient();

const COURTS = [
  {
    code: 'A',
    name: 'Center',
    blurb: 'Cushioned acrylic, tournament lighting and the only court with spectator seating.',
    meta: 'Indoor · 4m clearance · seats 20',
    sortOrder: 0,
  },
  {
    code: 'B',
    name: 'North',
    blurb: 'Quietest of the three, tucked behind the lounge wall. Popular for coaching.',
    meta: 'Indoor · 4m clearance',
    sortOrder: 1,
  },
  {
    code: 'C',
    name: 'Lanai',
    blurb: 'Covered open-air court with cross ventilation. Cooler in the early mornings.',
    meta: 'Covered outdoor · roofed',
    sortOrder: 2,
  },
];

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  for (const court of COURTS) {
    await prisma.court.upsert({
      where: { code: court.code },
      update: { name: court.name, blurb: court.blurb, meta: court.meta, sortOrder: court.sortOrder },
      create: court,
    });
  }

  // Passwords come from the environment when given, so a production database
  // can be seeded with real credentials in one step. The fallbacks exist for
  // local development and are announced loudly, because a known password on an
  // account that can verify passes and refund bookings is not a small thing.
  const deskPassword = process.env.SEED_DESK_PASSWORD || 'desk1234';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin1234';
  const usingDefaults = !process.env.SEED_DESK_PASSWORD || !process.env.SEED_ADMIN_PASSWORD;

  const staff = [
    { email: 'desk@picklelounge.ph', name: 'Front Desk', role: 'STAFF' as const, password: deskPassword },
    { email: 'admin@picklelounge.ph', name: 'Venue Admin', role: 'ADMIN' as const, password: adminPassword },
  ];

  const created: string[] = [];
  for (const person of staff) {
    const existing = await prisma.staffUser.findUnique({ where: { email: person.email } });
    if (existing) continue;
    await prisma.staffUser.create({
      data: {
        email: person.email,
        name: person.name,
        role: person.role,
        passwordHash: await hashPassword(person.password),
      },
    });
    created.push(person.email);
  }

  console.log(`Seeded ${COURTS.length} courts and venue settings.`);
  console.log(
    created.length > 0
      ? `Created staff accounts: ${created.join(', ')}`
      : 'Staff accounts already existed — left untouched.',
  );

  if (created.length > 0 && usingDefaults) {
    console.log('');
    console.log('  ⚠  Seeded with default passwords:');
    console.log('       desk@picklelounge.ph  / desk1234');
    console.log('       admin@picklelounge.ph / admin1234');
    console.log('');
    console.log('     These are published in this repository. Change them before the site is');
    console.log('     reachable, or re-seed a fresh database with your own:');
    console.log('       SEED_DESK_PASSWORD=... SEED_ADMIN_PASSWORD=... npm run db:seed');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

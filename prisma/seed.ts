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

  const staff = [
    { email: 'desk@picklelounge.ph', name: 'Front Desk', role: 'STAFF' as const, password: 'desk1234' },
    { email: 'admin@picklelounge.ph', name: 'Venue Admin', role: 'ADMIN' as const, password: 'admin1234' },
  ];

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
  }

  console.log('Seeded 3 courts, venue settings and 2 staff accounts.');
  console.log('  desk@picklelounge.ph  / desk1234   (front desk)');
  console.log('  admin@picklelounge.ph / admin1234  (admin)');
  console.log('Change these before going anywhere near production.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

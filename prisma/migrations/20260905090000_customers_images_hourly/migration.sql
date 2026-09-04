-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "courts" ADD COLUMN     "imageUrl" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "settings" DROP COLUMN "cancellationHours",
ADD COLUMN     "heroImageUrl" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "durationsMinutes" SET DEFAULT ARRAY[60, 120, 180]::INTEGER[];

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "bookings_customerId_startsAt_idx" ON "bookings"("customerId", "startsAt");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Changing the column default does not touch the row that already exists, so a
-- venue configured before this change would keep selling 90-minute blocks.
-- Drop any duration that is not a whole hour, and never leave the list empty.
UPDATE "settings"
SET "durationsMinutes" = (
  SELECT COALESCE(array_agg(d ORDER BY d), ARRAY[60]::integer[])
  FROM unnest("durationsMinutes") AS d
  WHERE d % 60 = 0
);

-- Bookings already taken at a half-hour length keep their times; only what the
-- venue offers from here on is constrained.

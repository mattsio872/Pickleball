/*
  Warnings:

  - You are about to drop the column `lastSlotHour` on the `settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "settings" DROP COLUMN "lastSlotHour",
ADD COLUMN     "closeHour" INTEGER NOT NULL DEFAULT 23;

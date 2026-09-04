import { prisma } from './db';
import type { Settings } from '@prisma/client';

/**
 * Venue configuration lives in a single database row so the admin can change
 * the rate or the opening hours without a redeploy. The row is created on
 * first read, which means a fresh database is usable before anyone has visited
 * the admin screens.
 */
export async function getSettings(): Promise<Settings> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export type PublicSettings = {
  venueName: string;
  city: string;
  timezone: string;
  currency: string;
  hourlyRateCents: number;
  openHour: number;
  closeHour: number;
  durationsMinutes: number[];
  maxPlayers: number;
  holdMinutes: number;
  cancellationHours: number;
  contactViber: string;
};

/** The subset of settings safe to hand to the browser. */
export function toPublicSettings(s: Settings): PublicSettings {
  return {
    venueName: s.venueName,
    city: s.city,
    timezone: s.timezone,
    currency: s.currency,
    hourlyRateCents: s.hourlyRateCents,
    openHour: s.openHour,
    closeHour: s.closeHour,
    durationsMinutes: [...s.durationsMinutes].sort((a, b) => a - b),
    maxPlayers: s.maxPlayers,
    holdMinutes: s.holdMinutes,
    cancellationHours: s.cancellationHours,
    contactViber: s.contactViber,
  };
}

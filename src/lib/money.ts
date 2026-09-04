/**
 * Money is handled in centavos throughout — integers only. Court time is priced
 * per hour but sold in fractional-hour blocks, so a float peso amount would let
 * a rounding error reach the payment provider, which charges what it is told.
 */

/** Total for a booking, rounded to the nearest centavo. */
export function priceFor(hourlyRateCents: number, minutes: number): number {
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents < 0) {
    throw new Error(`Invalid hourly rate: ${hourlyRateCents}`);
  }
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(`Invalid duration: ${minutes}`);
  }
  return Math.round((hourlyRateCents * minutes) / 60);
}

/** `₱650` or `₱975.50` — trailing `.00` is dropped, as PH pricing is usually written. */
export function formatPeso(cents: number): string {
  const pesos = cents / 100;
  const hasCentavos = cents % 100 !== 0;
  return `₱${pesos.toLocaleString('en-PH', {
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function centsToPesos(cents: number): number {
  return cents / 100;
}

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100);
}

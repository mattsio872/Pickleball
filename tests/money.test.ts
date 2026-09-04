import { describe, expect, it } from 'vitest';
import { formatPeso, priceFor, pesosToCents, centsToPesos } from '@/lib/money';

describe('priceFor', () => {
  it('charges the full rate for a whole hour', () => {
    expect(priceFor(65000, 60)).toBe(65000);
  });

  it('prorates fractional hours exactly', () => {
    expect(priceFor(65000, 90)).toBe(97500);
    expect(priceFor(65000, 30)).toBe(32500);
    expect(priceFor(65000, 180)).toBe(195000);
  });

  it('rounds to whole centavos rather than carrying a fraction', () => {
    // ₱333.33/h for 50 minutes is 27777.5 centavos — a real half-centavo.
    expect(priceFor(33333, 50)).toBe(27778);
    expect(Number.isInteger(priceFor(33333, 50))).toBe(true);
  });

  it('refuses nonsense input instead of producing a silent zero', () => {
    expect(() => priceFor(65000, 0)).toThrow();
    expect(() => priceFor(65000, -60)).toThrow();
    expect(() => priceFor(-1, 60)).toThrow();
    expect(() => priceFor(65000, 90.5)).toThrow();
  });
});

describe('formatPeso', () => {
  it('drops the decimals on whole pesos', () => {
    expect(formatPeso(65000)).toBe('₱650');
    expect(formatPeso(0)).toBe('₱0');
  });

  it('keeps them when there are centavos', () => {
    expect(formatPeso(97550)).toBe('₱975.50');
  });

  it('groups thousands', () => {
    expect(formatPeso(195000)).toBe('₱1,950');
  });
});

describe('peso/centavo conversion', () => {
  it('round-trips', () => {
    expect(centsToPesos(pesosToCents(650))).toBe(650);
    expect(pesosToCents(975.5)).toBe(97550);
  });
});

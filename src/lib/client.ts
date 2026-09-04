/** Browser-side helpers for talking to the API. */

export type ApiFailure = { code: string; message: string; details?: Record<string, string[]> };

export class ApiRequestError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Calls the API and throws a typed error on failure, so callers can show the
 * server's message rather than inventing one.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiRequestError({
      code: 'network',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const failure = (body as { error?: ApiFailure }).error;
    throw new ApiRequestError(
      failure ?? { code: 'unknown', message: `Request failed (HTTP ${response.status}).` },
    );
  }
  return body as T;
}

export function formatPesoClient(cents: number): string {
  const hasCentavos = cents % 100 !== 0;
  return `₱${(cents / 100).toLocaleString('en-PH', {
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

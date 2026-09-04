import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';

/** One shape for every API error, so the client never has to guess. */
export type ApiError = { error: { code: string; message: string; details?: Record<string, string[]> } };

export function fail(code: string, message: string, status: number, details?: Record<string, string[]>) {
  return NextResponse.json<ApiError>({ error: { code, message, details } }, { status });
}

/**
 * Turns a thrown error into a response.
 *
 * Known errors carry their own status and a message written for the person who
 * will read it. Anything else is logged in full and reported as a generic
 * failure — internal messages and stack traces are not the customer's business.
 */
export function handleError(error: unknown) {
  if (error instanceof AppError) {
    const details = 'details' in error ? (error as { details?: Record<string, string[]> }).details : undefined;
    return fail(error.code, error.message, error.status, details);
  }
  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    return fail('validation_failed', 'Please check the highlighted fields.', 400, details);
  }
  console.error('[api] Unhandled error:', error);
  return fail('internal_error', 'Something went wrong on our side. Please try again.', 500);
}

/** Wraps a route handler so thrown errors become well-formed responses. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}

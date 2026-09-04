/** Errors the API layer knows how to turn into a meaningful HTTP response. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The slot was free a moment ago and is not any more. */
export class SlotTakenError extends AppError {
  constructor(message = 'That slot has just been taken. Please pick another.') {
    super(message, 409, 'slot_taken');
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message, 400, 'validation_failed');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(message, 404, 'not_found');
  }
}

export class AuthError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to that.') {
    super(message, 403, 'forbidden');
  }
}

export class PaymentError extends AppError {
  constructor(message: string) {
    super(message, 502, 'payment_failed');
  }
}

// Fel som kan visas för användaren / returneras i API:t med rätt HTTP-status.
export class AppError extends Error {
  status = 400;
  code = 'invalid_request';
}
export class ValidationError extends AppError {
  status = 400;
  code = 'validation_error';
}
export class BookkeepingError extends AppError {
  status = 422;
  code = 'bookkeeping_error';
}
export class NotFoundError extends AppError {
  status = 404;
  code = 'not_found';
  constructor(what = 'Objektet') { super(`${what} finns inte`); }
}
export class ConflictError extends AppError {
  status = 409;
  code = 'conflict';
}
export class ForbiddenError extends AppError {
  status = 403;
  code = 'forbidden';
}

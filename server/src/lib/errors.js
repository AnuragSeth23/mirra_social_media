export class AppError extends Error {
  status;
  code;
  details;
  headers;

  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'unauthorized', message = 'Sign in to continue.') => new AppError(401, code, message);
export const forbidden = (code, message, details) => new AppError(403, code, message, details);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const tooMany = (message, retryAfterSeconds) => new AppError(429, 'rate_limited', message, { retryAfter: retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) });

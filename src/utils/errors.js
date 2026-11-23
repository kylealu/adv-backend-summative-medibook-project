/** An error that carries an HTTP status, turned into JSON by the error middleware. */
class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, { code: 'VALIDATION_ERROR', details });
const notFound = (message) => new HttpError(404, message, { code: 'NOT_FOUND' });
const conflict = (message, details, code = 'CONFLICT') => new HttpError(409, message, { code, details });
const unprocessable = (message, code = 'BUSINESS_RULE_VIOLATION', details) =>
  new HttpError(422, message, { code, details });

module.exports = { HttpError, badRequest, notFound, conflict, unprocessable };

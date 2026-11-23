const { HttpError } = require('../utils/errors');

/** 404 for unmatched routes. */
function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` } });
}

/**
 * Central error handler: every error thrown in a controller ends up here.
 * Known MySQL errors are translated as a safety net (the controllers check
 * first, but the database constraints are the final authority).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'Something went wrong' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code || 'ERROR', message: err.message };
    if (err.details !== undefined) body.details = err.details;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    body = { code: 'DUPLICATE', message: 'A record with the same unique value already exists' };
  } else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    status = 409;
    body = { code: 'HAS_DEPENDENTS', message: 'Record is referenced by other records and cannot be deleted' };
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 404;
    body = { code: 'NOT_FOUND', message: 'A referenced record does not exist' };
  } else if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    status = 422;
    body = { code: 'CONSTRAINT_VIOLATION', message: 'The data violates a database rule' };
  }

  // Full stack traces only for unexpected errors; deliberate HttpErrors (e.g. 503) are expected.
  if (status >= 500 && !(err instanceof HttpError)) console.error('[error]', err);
  res.status(status).json({ error: body });
}

module.exports = { notFoundHandler, errorHandler };

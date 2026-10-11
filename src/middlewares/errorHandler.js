const { ValidationError, UniqueConstraintError } = require('sequelize');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');

function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof UniqueConstraintError) {
    const errors = err.errors.map((e) => ({ field: e.path, message: `${e.path} is already in use` }));
    return ApiError.conflict(errors[0]?.message || 'Duplicate value', errors);
  }
  if (err instanceof ValidationError) {
    const errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest('Validation failed', errors);
  }
  if (err.type === 'entity.parse.failed') return ApiError.badRequest('Invalid JSON body');
  if (err.type === 'entity.too.large') return new ApiError(413, 'Request body too large');

  const status = err.statusCode || err.status;
  if (status && status < 500) return new ApiError(status, err.message);

  return new ApiError(500, 'Internal server error');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiErr = normalize(err);

  if (apiErr.statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.originalUrl, method: req.method });
  }

  if (req.originalUrl.startsWith('/admin')) {
    return res.status(apiErr.statusCode).render('admin/pages/error', {
      layout: 'admin/layouts/auth',
      title: 'Error',
      statusCode: apiErr.statusCode,
      message: apiErr.statusCode >= 500 ? 'Something went wrong. Please try again.' : apiErr.message,
    });
  }

  return res.status(apiErr.statusCode).json({
    success: false,
    message: apiErr.message,
    ...(apiErr.errors && { errors: apiErr.errors }),
    ...(!env.isProduction && apiErr.statusCode >= 500 && { debug: err.message }),
  });
}

module.exports = { notFound, errorHandler };

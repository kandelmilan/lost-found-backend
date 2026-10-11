const ApiError = require('../utils/ApiError');

// Usage: router.post('/x', validate(schema), handler)
//        router.get('/x', validate(schema, 'query'), handler)
function validate(schema, source = 'body') {
  return (req, res, next) => {
    // Express 5 leaves req.body undefined when no body is sent; treat that as {}.
    const { value, error } = schema.validate(req[source] ?? {}, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        // Object-level rules like .or('email', 'phone') have no path, so name the fields involved.
        field: d.path.join('.') || (d.context?.peers || []).join('|') || 'body',
        message: d.message.replace(/"/g, ''),
      }));
      return next(ApiError.badRequest('Validation failed', errors));
    }

    // req.query is a getter in Express 5, so validated values go on req.validated instead.
    req.validated = { ...req.validated, [source]: value };
    if (source === 'body') req.body = value;
    return next();
  };
}

module.exports = validate;

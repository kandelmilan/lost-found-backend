const Joi = require('joi');

// Admin forms post strings; checkboxes are missing when unchecked.
const category = Joi.object({
  name: Joi.string().trim().min(2).max(60).required(),
  icon: Joi.string()
    .trim()
    .max(60)
    .pattern(/^[a-z0-9-]*$/)
    .allow('')
    .messages({ 'string.pattern.base': 'Icon must be lowercase letters, numbers and dashes (e.g. "credit-card")' }),
  sort_order: Joi.number().integer().min(0).max(9999).empty('').default(0),
  is_active: Joi.boolean().truthy('on', '1').falsy('0').default(false),
  _csrf: Joi.any().strip(),
});

// Table filters (search, paging and sorting are read by utils/listQuery).
const itemFilters = Joi.object({
  type: Joi.string().valid('lost', 'found').empty(''),
  status: Joi.string().valid('open', 'claimed', 'returned', 'closed').empty(''),
  category: Joi.number().integer().positive().empty(''),
  visibility: Joi.string().valid('visible', 'hidden').empty(''),
});

const userFilters = Joi.object({
  status: Joi.string().valid('active', 'blocked').empty(''),
});

// Keeps only the filters that are valid; anything else in the URL is ignored.
function pickValid(schema, query) {
  const keys = Object.keys(schema.describe().keys);
  const out = {};
  keys.forEach((key) => {
    const { value, error } = schema.extract(key).validate(query[key]);
    if (!error && value !== undefined) out[key] = value;
  });
  return out;
}

const reason = Joi.object({
  reason: Joi.string().trim().max(500).allow('').default(''),
  _csrf: Joi.any().strip(),
});

module.exports = { category, itemFilters, userFilters, reason, pickValid };

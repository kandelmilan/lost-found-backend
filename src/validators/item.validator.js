const Joi = require('joi');

// Checked on every request (not once at startup). One day of slack because the user's
// local date can be ahead of UTC (Nepal is UTC+5:45).
const notInFuture = (value, helpers) =>
  value.getTime() > Date.now() + 24 * 60 * 60 * 1000 ? helpers.message('event_date cannot be in the future') : value;

const fields = {
  title: Joi.string().trim().min(3).max(120),
  description: Joi.string().trim().max(2000).allow(''),
  category_id: Joi.number().integer().positive(),
  event_date: Joi.date().iso().min('2000-01-01').custom(notInFuture),
  area_name: Joi.string().trim().min(2).max(150),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
  secret_question: Joi.string().trim().min(5).max(255),
  secret_answer: Joi.string().trim().min(1).max(100),
};

// Found items need a secret question that only the real owner can answer.
// Lost items don't have one (the owner is the poster).
const create = Joi.object({
  type: Joi.string().valid('lost', 'found').required(),
  title: fields.title.required(),
  description: fields.description,
  category_id: fields.category_id.required(),
  event_date: fields.event_date.required(),
  area_name: fields.area_name.required(),
  latitude: fields.latitude.required(),
  longitude: fields.longitude.required(),
  secret_question: fields.secret_question.when('type', {
    is: 'found',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  secret_answer: fields.secret_answer.when('type', {
    is: 'found',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

const update = Joi.object({
  title: fields.title,
  description: fields.description,
  category_id: fields.category_id,
  event_date: fields.event_date,
  area_name: fields.area_name,
  latitude: fields.latitude,
  longitude: fields.longitude,
  secret_question: fields.secret_question,
  secret_answer: fields.secret_answer,
})
  .and('latitude', 'longitude')
  .and('secret_question', 'secret_answer')
  .min(1);

const list = Joi.object({
  type: Joi.string().valid('lost', 'found'),
  category: Joi.alternatives(Joi.number().integer().positive(), Joi.string().trim().max(60)).description(
    'Category id or slug',
  ),
  q: Joi.string().trim().max(100).allow(''),
  lat: Joi.number().min(-90).max(90),
  lng: Joi.number().min(-180).max(180),
  radius_km: Joi.number().min(0.5).max(200).default(10),
  date_from: Joi.date().iso(),
  date_to: Joi.date().iso().min(Joi.ref('date_from')),
  sort: Joi.string().valid('newest', 'nearest').default('newest'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
})
  .and('lat', 'lng')
  .custom((value, helpers) => {
    if (value.sort === 'nearest' && value.lat === undefined) {
      return helpers.message('sort=nearest needs lat and lng');
    }
    return value;
  });

const mine = Joi.object({
  status: Joi.string().valid('open', 'claimed', 'returned', 'closed'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = { create, update, list, mine };

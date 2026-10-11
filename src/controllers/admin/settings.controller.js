const Joi = require('joi');
const { Op } = require('sequelize');
const { AdminLog, Session } = require('../../models');

const passwordSchema = Joi.object({
  current_password: Joi.string().required().messages({ 'any.required': 'Enter your current password', 'string.empty': 'Enter your current password' }),
  new_password: Joi.string()
    .min(10)
    .max(72)
    .pattern(/[A-Za-z]/)
    .pattern(/[0-9]/)
    .required()
    .messages({
      'string.min': 'New password must be at least 10 characters',
      'string.pattern.base': 'New password needs at least one letter and one number',
      'string.empty': 'Enter a new password',
    }),
  confirm_password: Joi.any().valid(Joi.ref('new_password')).required().messages({ 'any.only': 'The two new passwords do not match' }),
  _csrf: Joi.any().strip(),
});

function render(res, { error = null, status = 200 } = {}) {
  res.status(status).render('admin/pages/settings', { title: 'Settings', active: 'settings', error });
}

function show(req, res) {
  render(res);
}

async function changePassword(req, res, next) {
  const { value, error } = passwordSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
  if (error) return render(res, { error: error.details[0].message, status: 400 });

  const admin = req.admin;
  if (!(await admin.checkPassword(value.current_password))) {
    return render(res, { error: 'Your current password is incorrect', status: 400 });
  }
  if (value.current_password === value.new_password) {
    return render(res, { error: 'Choose a password you have not used just now', status: 400 });
  }

  await admin.update({ password_hash: await admin.constructor.hashPassword(value.new_password) });

  // Sign out this admin everywhere else (sessions store the admin id in their JSON data).
  await Session.destroy({
    where: {
      sid: { [Op.ne]: req.sessionID },
      [Op.or]: [{ data: { [Op.like]: `%"adminId":${admin.id},%` } }, { data: { [Op.like]: `%"adminId":${admin.id}}%` } }],
    },
  });
  await AdminLog.record(req, 'admin.password_change', { targetType: 'user', targetId: admin.id });

  // New session id after a credential change.
  const { adminId, csrfToken } = req.session;
  return req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.adminId = adminId;
    req.session.csrfToken = csrfToken;
    req.flash('success', 'Password changed. Other devices have been signed out.');
    return req.session.save(() => res.redirect('/admin/settings'));
  });
}

module.exports = { show, changePassword };

const categoryService = require('../../services/category.service');
const schemas = require('../../validators/admin.validator');
const ApiError = require('../../utils/ApiError');

function readForm(req) {
  const { value, error } = schemas.category.validate(req.body, { stripUnknown: true, abortEarly: true });
  if (error) throw ApiError.badRequest(error.details[0].message.replace(/"/g, ''));
  return value;
}

// Form problems (validation, duplicates, "has items") go back to the page as a message
// instead of an error screen.
async function withFlash(req, res, redirectTo, action) {
  try {
    await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode >= 500 || err.statusCode === 404) throw err;
    req.flash('danger', err.message);
  }
  res.redirect(redirectTo);
}

async function index(req, res) {
  res.render('admin/pages/categories/index', {
    title: 'Categories',
    active: 'categories',
    rows: await categoryService.listWithCounts(),
  });
}

async function create(req, res) {
  await withFlash(req, res, '/admin/categories', async () => {
    // New categories start active, whatever the checkbox says.
    const category = await categoryService.create(req, { ...readForm(req), is_active: true });
    req.flash('success', `Category "${category.name}" added.`);
  });
}

async function edit(req, res) {
  const category = await categoryService.findOrFail(Number(req.params.id));
  res.render('admin/pages/categories/edit', { title: `Edit ${category.name}`, active: 'categories', category });
}

async function update(req, res) {
  const id = Number(req.params.id);
  await withFlash(req, res, `/admin/categories/${id}/edit`, async () => {
    const category = await categoryService.update(req, id, readForm(req));
    req.flash('success', `Category "${category.name}" saved.`);
  });
}

async function destroy(req, res) {
  await withFlash(req, res, '/admin/categories', async () => {
    const category = await categoryService.remove(req, Number(req.params.id));
    req.flash('success', `Category "${category.name}" deleted.`);
  });
}

module.exports = { index, create, edit, update, destroy };

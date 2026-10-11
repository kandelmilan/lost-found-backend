const itemService = require('../../services/item.service');
const { Category } = require('../../models');
const schemas = require('../../validators/admin.validator');
const itemSchemas = require('../../validators/item.validator');
const ApiError = require('../../utils/ApiError');
const { pageMeta } = require('../../utils/pagination');
const { parseListQuery, linkQuery } = require('../../utils/listQuery');
const { sendCsv } = require('../../utils/csv');

const listOptions = { sorts: itemService.ADMIN_SORTS, defaultSort: 'posted', defaultDir: 'desc' };

function readList(query) {
  return {
    list: parseListQuery(query, listOptions),
    filters: schemas.pickValid(schemas.itemFilters, query),
  };
}

const categoriesForSelect = () =>
  Category.findAll({ order: [['sort_order', 'ASC'], ['name', 'ASC']], attributes: ['id', 'name', 'is_active'] });

async function index(req, res) {
  const { list, filters } = readList(req.query);
  const [{ items, total }, categories] = await Promise.all([
    itemService.adminList({ ...filters, q: list.q, page: list.page, limit: list.limit, order: list.order }),
    categoriesForSelect(),
  ]);

  const query = linkQuery({ q: list.q, limit: list.limit, ...filters });
  res.render('admin/pages/items/index', {
    title: 'Items',
    active: 'items',
    items,
    categories,
    list,
    filters,
    query,
    pageQuery: linkQuery({ ...query, sort: list.sort, dir: list.dir }),
    exportUrl: `/admin/items/export?${new URLSearchParams(linkQuery({ ...query, sort: list.sort, dir: list.dir }))}`,
    pagination: pageMeta({ page: list.page, limit: list.limit, total }),
  });
}

async function exportCsv(req, res) {
  const { list, filters } = readList(req.query);
  const items = await itemService.adminExport({ ...filters, q: list.q, order: list.order });

  sendCsv(
    res,
    'items',
    [
      { label: 'ID', value: (i) => i.id },
      { label: 'Type', value: (i) => i.type },
      { label: 'Title', value: (i) => i.title },
      { label: 'Category', value: (i) => i.category?.name },
      { label: 'Status', value: (i) => i.status },
      { label: 'Hidden', value: (i) => (i.is_hidden ? 'yes' : 'no') },
      { label: 'Date lost/found', value: (i) => i.event_date },
      { label: 'Area', value: (i) => i.area_name },
      { label: 'Latitude', value: (i) => i.latitude },
      { label: 'Longitude', value: (i) => i.longitude },
      { label: 'Posted by', value: (i) => i.owner?.name },
      { label: 'Owner contact', value: (i) => i.owner?.email || i.owner?.phone },
      { label: 'Posted at', value: (i) => i.createdAt },
    ],
    items,
  );
}

// ---------- Post item (admin) ----------

const EMPTY_FORM = {
  type: 'found',
  title: '',
  description: '',
  category_id: '',
  event_date: new Date().toISOString().slice(0, 10),
  area_name: '',
  latitude: '',
  longitude: '',
  secret_question: '',
};

// Same form for posting and editing; `editing` is the item being edited.
async function renderForm(res, { values = EMPTY_FORM, errors = {}, status = 200, editing = null } = {}) {
  const categories = await categoriesForSelect();
  res.status(status).render('admin/pages/items/new', {
    title: editing ? `Edit ${editing.title}` : 'Post Item',
    crumb: editing ? `Items / #${editing.id} / Edit` : 'Items / Post Item',
    active: 'items',
    useMap: true,
    // Keep the item's current category in the list even if it was deactivated since.
    categories: categories.filter((c) => c.is_active || (editing && c.id === editing.category_id)),
    values: { ...EMPTY_FORM, event_date: new Date().toISOString().slice(0, 10), ...values },
    errors,
    editing,
  });
}

function collectErrors(error) {
  const errors = {};
  error.details.forEach((d) => {
    const field = d.path[0] || 'form';
    errors[field] = errors[field] || d.message.replace(/"/g, '');
  });
  return errors;
}

// ---------- Edit ----------

async function loadForEdit(id) {
  const { item } = await itemService.adminGet(id);
  return item;
}

async function editForm(req, res) {
  const item = await loadForEdit(Number(req.params.id));
  await renderForm(res, {
    editing: item,
    values: {
      type: item.type,
      title: item.title,
      description: item.description || '',
      category_id: item.category_id,
      event_date: item.event_date,
      area_name: item.area_name,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      secret_question: item.secret_question || '',
    },
  });
}

async function update(req, res) {
  const id = Number(req.params.id);
  const item = await loadForEdit(id);
  const { _csrf: _ignored, secret_answer: answer, remove_images: removeRaw, type: _type, ...values } = req.body;

  // The question is only changed together with a new answer.
  const input = { ...values };
  if (item.type !== 'found' || !String(answer || '').trim()) delete input.secret_question;
  else input.secret_answer = answer;

  const removeIds = [].concat(removeRaw || []).map(Number).filter(Number.isInteger);
  const { value, error } = itemSchemas.update.validate(input, { abortEarly: false, stripUnknown: true, convert: true });
  const rerender = (errors) => renderForm(res, { editing: item, values: { ...values, type: item.type }, errors, status: 400 });
  if (error) return rerender(collectErrors(error));

  try {
    await itemService.adminUpdate(req, id, value, req.files || [], removeIds);
    req.flash('success', 'Item updated.');
    return res.redirect(`/admin/items/${id}`);
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode >= 500) throw err;
    const field = err.errors?.[0]?.field || 'images';
    return rerender({ [field]: err.errors?.[0]?.message || err.message });
  }
}

async function newForm(req, res) {
  await renderForm(res);
}

async function create(req, res) {
  // The secret answer is never sent back into the form.
  const { _csrf: _ignored, secret_answer: _answer, ...values } = req.body;

  const { value, error } = itemSchemas.create.validate(req.body, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) return renderForm(res, { values, errors: collectErrors(error), status: 400 });

  try {
    const item = await itemService.adminCreate(req, value, req.files || []);
    req.flash('success', `"${item.title}" was posted.`);
    return res.redirect(`/admin/items/${item.id}`);
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode >= 500) throw err;
    const field = err.errors?.[0]?.field || 'images';
    return renderForm(res, { values, errors: { [field]: err.errors?.[0]?.message || err.message }, status: 400 });
  }
}

// ---------- Detail + moderation ----------

async function show(req, res) {
  const { item, history, claims } = await itemService.adminGet(Number(req.params.id));
  res.render('admin/pages/items/show', {
    title: item.title,
    crumb: `Items / #${item.id}`,
    active: 'items',
    item,
    history,
    claims,
  });
}

const readReason = (req) => schemas.reason.validate(req.body, { stripUnknown: true }).value?.reason || '';

async function hide(req, res) {
  const item = await itemService.adminSetHidden(req, Number(req.params.id), true, readReason(req));
  req.flash('success', `"${item.title}" is now hidden from the app.`);
  res.redirect(`/admin/items/${item.id}`);
}

async function unhide(req, res) {
  const item = await itemService.adminSetHidden(req, Number(req.params.id), false);
  req.flash('success', `"${item.title}" is visible again.`);
  res.redirect(`/admin/items/${item.id}`);
}

async function destroy(req, res) {
  const item = await itemService.adminDelete(req, Number(req.params.id), readReason(req));
  req.flash('success', `Item #${item.id} "${item.title}" was deleted.`);
  res.redirect('/admin/items');
}

module.exports = { index, exportCsv, newForm, create, editForm, update, show, hide, unhide, destroy };

const { Op, fn, col } = require('sequelize');
const { Category, Item, AdminLog } = require('../models');
const ApiError = require('../utils/ApiError');

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

async function listWithCounts() {
  const [categories, counts] = await Promise.all([
    Category.findAll({ order: [['sort_order', 'ASC'], ['name', 'ASC']] }),
    Item.findAll({ attributes: ['category_id', [fn('COUNT', col('id')), 'count']], group: ['category_id'], raw: true }),
  ]);
  const byId = Object.fromEntries(counts.map((c) => [c.category_id, Number(c.count)]));
  return categories.map((c) => ({ category: c, itemCount: byId[c.id] || 0 }));
}

async function findOrFail(id) {
  const category = await Category.findByPk(id);
  if (!category) throw ApiError.notFound('Category not found');
  return category;
}

async function ensureUnique(name, slug, excludeId) {
  const where = { [Op.or]: [{ name }, { slug }] };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  if (await Category.findOne({ where })) throw ApiError.conflict(`A category named "${name}" already exists`);
}

async function create(req, { name, icon, sort_order: sortOrder }) {
  const slug = slugify(name);
  if (!slug) throw ApiError.badRequest('Name must contain letters or numbers');
  await ensureUnique(name, slug);

  const category = await Category.create({ name, slug, icon: icon || null, sort_order: sortOrder ?? 0 });
  await AdminLog.record(req, 'category.create', { targetType: 'category', targetId: category.id, details: { name } });
  return category;
}

// The slug is kept when renaming, so the app's saved filters keep working.
async function update(req, id, { name, icon, sort_order: sortOrder, is_active: isActive }) {
  const category = await findOrFail(id);
  await ensureUnique(name, category.slug, category.id);

  const before = { name: category.name, is_active: category.is_active };
  await category.update({ name, icon: icon || null, sort_order: sortOrder ?? 0, is_active: isActive });
  await AdminLog.record(req, 'category.update', {
    targetType: 'category',
    targetId: category.id,
    details: { before, after: { name, is_active: isActive } },
  });
  return category;
}

async function remove(req, id) {
  const category = await findOrFail(id);
  const itemCount = await Item.count({ where: { category_id: id } });
  if (itemCount) {
    throw ApiError.badRequest(
      `"${category.name}" has ${itemCount} item${itemCount === 1 ? '' : 's'}. Deactivate it instead of deleting.`,
    );
  }
  await category.destroy();
  await AdminLog.record(req, 'category.delete', { targetType: 'category', targetId: id, details: { name: category.name } });
  return category;
}

module.exports = { listWithCounts, findOrFail, create, update, remove };

const { Category } = require('../../models');
const { ok } = require('../../utils/response');

async function list(req, res) {
  const categories = await Category.findAll({
    where: { is_active: true },
    attributes: ['id', 'name', 'slug', 'icon'],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });
  return ok(res, categories);
}

module.exports = { list };

const itemService = require('../../services/item.service');
const { ok, created } = require('../../utils/response');
const { pageMeta } = require('../../utils/pagination');

const itemId = (req) => Number(req.params.id);

async function create(req, res) {
  const item = await itemService.createItem(req.user, req.body, req.files || []);
  return created(res, item, 'Item posted');
}

async function list(req, res) {
  const filters = req.validated.query;
  const { items, total } = await itemService.listItems(filters, req.user);
  return ok(res, items, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function mine(req, res) {
  const filters = req.validated.query;
  const { items, total } = await itemService.listMine(req.user, filters);
  return ok(res, items, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function show(req, res) {
  return ok(res, await itemService.getItem(itemId(req), req.user));
}

async function update(req, res) {
  return ok(res, await itemService.updateItem(req.user, itemId(req), req.body), 'Item updated');
}

async function addImages(req, res) {
  return ok(res, await itemService.addImages(req.user, itemId(req), req.files || []), 'Images added');
}

async function deleteImage(req, res) {
  return ok(res, await itemService.deleteImage(req.user, itemId(req), Number(req.params.imageId)), 'Image removed');
}

async function close(req, res) {
  return ok(res, await itemService.closeItem(req.user, itemId(req)), 'Item closed');
}

async function destroy(req, res) {
  await itemService.deleteItem(req.user, itemId(req));
  return ok(res, null, 'Item deleted');
}

async function matches(req, res) {
  return ok(res, await itemService.findMatches(req.user, itemId(req)));
}

module.exports = { create, list, mine, show, update, addImages, deleteImage, close, destroy, matches };

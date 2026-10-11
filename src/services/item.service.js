const { Op, literal, where: sqlWhere } = require('sequelize');
const { sequelize, Item, ItemImage, Category, AdminLog, Claim } = require('../models');
const ApiError = require('../utils/ApiError');
const storage = require('./storage.service');
const claimService = require('./claim.service');
const { notify } = require('./notification.service');

const MAX_IMAGES = 5;
const MATCH_RADIUS_KM = 15;
const MATCH_DAYS = 30;

// ---------------------------------------------------------------------------
// Serialising — the only place that decides what the app is allowed to see.
// ---------------------------------------------------------------------------

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Privacy rules:
 *  - Only the owner sees exact coordinates. Everyone else gets them rounded to ~1 km.
 *  - Distance for others is rounded up to 0.5 km so exact spots can't be triangulated.
 *  - secret_answer_hash is never sent. The question is shown so owners can answer it.
 */
function serialize(item, viewer) {
  const isOwner = Boolean(viewer && viewer.id === item.user_id);
  const lat = Number(item.latitude);
  const lng = Number(item.longitude);
  const distanceM = item.get('distance_m');

  let distanceKm;
  if (distanceM !== undefined && distanceM !== null) {
    const km = Number(distanceM) / 1000;
    distanceKm = isOwner ? round(km, 1) : Math.max(0.5, Math.ceil(km * 2) / 2);
  }

  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description || '',
    status: item.status,
    category: item.category
      ? { id: item.category.id, name: item.category.name, slug: item.category.slug, icon: item.category.icon }
      : null,
    event_date: item.event_date,
    area_name: item.area_name,
    location: isOwner
      ? { latitude: lat, longitude: lng, approximate: false }
      : { latitude: round(lat, 2), longitude: round(lng, 2), approximate: true },
    ...(distanceKm !== undefined && { distance_km: distanceKm }),
    secret_question: item.type === 'found' ? item.secret_question : null,
    images: (item.images || []).map((img) => ({ id: img.id, url: img.url, width: img.width, height: img.height })),
    owner: item.owner ? { id: item.owner.id, name: item.owner.name, avatar_url: item.owner.avatar_url } : null,
    is_mine: isOwner,
    ...(isOwner && { is_hidden: item.is_hidden, hidden_reason: item.is_hidden ? item.hidden_reason : null }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const imagesInclude = { association: 'images', separate: true, order: [['sort_order', 'ASC'], ['id', 'ASC']] };
const categoryInclude = { association: 'category', attributes: ['id', 'name', 'slug', 'icon'] };
// Items of blocked users disappear from public views.
const activeOwnerInclude = {
  association: 'owner',
  attributes: ['id', 'name', 'avatar_url'],
  where: { is_blocked: false },
  required: true,
};

// lat/lng have already been validated as numbers by Joi; Number() + isFinite is a second guard
// because they are placed directly into SQL.
function distanceExpr(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) throw ApiError.badRequest('Invalid coordinates');
  return `ST_Distance_Sphere(POINT(\`Item\`.\`longitude\`, \`Item\`.\`latitude\`), POINT(${ln}, ${la}))`;
}

// Cheap rectangle filter so MySQL can use the (latitude, longitude) index before the exact distance check.
function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    latitude: { [Op.between]: [lat - dLat, lat + dLat] },
    longitude: { [Op.between]: [lng - dLng, lng + dLng] },
  };
}

function escapeLike(q) {
  return `%${q.replace(/[%_\\]/g, '\\$&')}%`;
}

async function findCategory(categoryId) {
  const category = await Category.findOne({ where: { id: categoryId, is_active: true } });
  if (!category) {
    throw ApiError.badRequest('Validation failed', [{ field: 'category_id', message: 'category_id is not a valid category' }]);
  }
  return category;
}

async function findOwnedItem(user, id, { requireOpen = false } = {}) {
  const item = await Item.findByPk(id, { include: [imagesInclude, categoryInclude] });
  if (!item) throw ApiError.notFound('Item not found');
  if (item.user_id !== user.id) throw ApiError.forbidden('You can only change your own items');
  if (requireOpen && !item.isOpen()) throw ApiError.badRequest(`This item is ${item.status} and can no longer be changed`);
  return item;
}

async function saveUploadedImages(files) {
  const saved = [];
  try {
    // One at a time keeps memory use low on small servers.
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await storage.saveImage('items', file.buffer));
    }
    return saved;
  } catch (err) {
    await storage.removeFiles(saved.map((s) => s.key));
    throw err;
  }
}

async function reloadForResponse(id) {
  return Item.findByPk(id, {
    include: [imagesInclude, categoryInclude, { association: 'owner', attributes: ['id', 'name', 'avatar_url'] }],
  });
}

// ---------------------------------------------------------------------------
// App (mobile) operations
// ---------------------------------------------------------------------------

async function createItem(user, data, files = []) {
  await findCategory(data.category_id);

  const saved = await saveUploadedImages(files);
  try {
    const item = await sequelize.transaction(async (transaction) => {
      const created = await Item.create(
        {
          user_id: user.id,
          type: data.type,
          title: data.title,
          description: data.description || null,
          category_id: data.category_id,
          event_date: data.event_date,
          area_name: data.area_name,
          latitude: data.latitude,
          longitude: data.longitude,
          secret_question: data.type === 'found' ? data.secret_question : null,
          secret_answer_hash: data.type === 'found' ? await Item.hashAnswer(data.secret_answer) : null,
        },
        { transaction },
      );
      await ItemImage.bulkCreate(
        saved.map((s, i) => ({ item_id: created.id, storage_key: s.key, url: s.url, width: s.width, height: s.height, sort_order: i })),
        { transaction },
      );
      return created;
    });
    return serialize(await reloadForResponse(item.id), user);
  } catch (err) {
    await storage.removeFiles(saved.map((s) => s.key));
    throw err;
  }
}

async function listItems(filters, viewer) {
  const where = { status: 'open', is_hidden: false };
  const include = [{ ...categoryInclude }, activeOwnerInclude, imagesInclude];
  const attributes = { include: [] };
  const and = [];

  if (filters.type) where.type = filters.type;

  if (filters.category !== undefined) {
    if (typeof filters.category === 'number') where.category_id = filters.category;
    else include[0] = { ...categoryInclude, where: { slug: filters.category }, required: true };
  }

  if (filters.q) {
    const like = escapeLike(filters.q);
    where[Op.or] = [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }, { area_name: { [Op.like]: like } }];
  }

  if (filters.date_from || filters.date_to) {
    where.event_date = {
      ...(filters.date_from && { [Op.gte]: filters.date_from }),
      ...(filters.date_to && { [Op.lte]: filters.date_to }),
    };
  }

  let order = [['createdAt', 'DESC'], ['id', 'DESC']];
  if (filters.lat !== undefined) {
    const expr = distanceExpr(filters.lat, filters.lng);
    Object.assign(where, boundingBox(filters.lat, filters.lng, filters.radius_km));
    and.push(sqlWhere(literal(expr), Op.lte, filters.radius_km * 1000));
    attributes.include.push([literal(expr), 'distance_m']);
    if (filters.sort === 'nearest') order = [[literal('distance_m'), 'ASC'], ['id', 'DESC']];
  }
  if (and.length) where[Op.and] = and;

  const { rows, count } = await Item.findAndCountAll({
    where,
    attributes,
    include,
    order,
    limit: filters.limit,
    offset: (filters.page - 1) * filters.limit,
    distinct: true,
  });

  return { items: rows.map((item) => serialize(item, viewer)), total: count };
}

async function listMine(user, { status, page, limit }) {
  const where = { user_id: user.id };
  if (status) where.status = status;

  const { rows, count } = await Item.findAndCountAll({
    where,
    include: [categoryInclude, { association: 'owner', attributes: ['id', 'name', 'avatar_url'] }, imagesInclude],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { items: rows.map((item) => serialize(item, user)), total: count };
}

async function getItem(id, viewer) {
  const item = await Item.findByPk(id, {
    include: [categoryInclude, { association: 'owner', attributes: ['id', 'name', 'avatar_url', 'is_blocked'] }, imagesInclude],
  });
  const isOwner = viewer && item && item.user_id === viewer.id;
  if (!item || (!isOwner && (item.is_hidden || item.owner?.is_blocked))) throw ApiError.notFound('Item not found');
  return { ...serialize(item, viewer), ...(await claimService.claimStateForItem(item, viewer)) };
}

async function updateItem(user, id, changes) {
  const item = await findOwnedItem(user, id, { requireOpen: true });

  if (changes.secret_question !== undefined && item.type !== 'found') {
    throw ApiError.badRequest('Validation failed', [
      { field: 'secret_question', message: 'Only found items have a secret question' },
    ]);
  }
  if (changes.category_id !== undefined) await findCategory(changes.category_id);

  const { secret_answer: answer, ...rest } = changes;
  if (rest.description === '') rest.description = null;
  await item.update({ ...rest, ...(answer !== undefined && { secret_answer_hash: await Item.hashAnswer(answer) }) });

  return serialize(await reloadForResponse(item.id), user);
}

async function addImages(user, id, files) {
  if (!files.length) throw ApiError.badRequest('Add at least one image in the "images" field');
  const item = await findOwnedItem(user, id, { requireOpen: true });

  const existing = item.images.length;
  if (existing + files.length > MAX_IMAGES) {
    throw ApiError.badRequest(`An item can have up to ${MAX_IMAGES} images (it has ${existing})`);
  }

  const saved = await saveUploadedImages(files);
  try {
    const lastOrder = item.images.reduce((max, img) => Math.max(max, img.sort_order), -1);
    await ItemImage.bulkCreate(
      saved.map((s, i) => ({ item_id: item.id, storage_key: s.key, url: s.url, width: s.width, height: s.height, sort_order: lastOrder + 1 + i })),
    );
  } catch (err) {
    await storage.removeFiles(saved.map((s) => s.key));
    throw err;
  }
  return serialize(await reloadForResponse(item.id), user);
}

async function deleteImage(user, id, imageId) {
  const item = await findOwnedItem(user, id, { requireOpen: true });
  const image = item.images.find((img) => img.id === imageId);
  if (!image) throw ApiError.notFound('Image not found');

  await image.destroy();
  await storage.removeFiles([image.storage_key]);
  return serialize(await reloadForResponse(item.id), user);
}

// Owner no longer needs the post (e.g. found it themselves).
async function closeItem(user, id) {
  const item = await findOwnedItem(user, id, { requireOpen: true });
  await sequelize.transaction(async (transaction) => {
    await item.update({ status: 'closed' }, { transaction });
    await claimService.rejectPendingForItem(item.id, 'The poster closed this item', transaction);
  });
  return serialize(await reloadForResponse(item.id), user);
}

async function deleteItem(user, id) {
  const item = await findOwnedItem(user, id);
  if (item.status === 'claimed') throw ApiError.badRequest('This item has an accepted claim and cannot be deleted yet');
  const keys = item.images.map((img) => img.storage_key);
  await item.destroy();
  await storage.removeFiles(keys);
}

// ---------------------------------------------------------------------------
// Matching: for my lost item, which found items might be it (and vice versa)?
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'near', 'lost', 'found', 'my', 'a', 'an', 'of', 'in', 'at', 'on']);
const words = (text) =>
  new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );

function matchScore(source, candidate) {
  const distanceKm = Number(candidate.get('distance_m')) / 1000;
  const days = Math.abs(new Date(candidate.event_date) - new Date(source.event_date)) / 86400000;

  const a = words(`${source.title} ${source.description}`);
  const b = words(`${candidate.title} ${candidate.description}`);
  const shared = [...a].filter((w) => b.has(w)).length;
  const textScore = a.size && b.size ? shared / Math.min(a.size, b.size) : 0;

  // Same category is already required. Distance 40%, date 30%, words 30%.
  const score = (1 - distanceKm / MATCH_RADIUS_KM) * 40 + (1 - days / MATCH_DAYS) * 30 + textScore * 30;
  return Math.round(Math.max(0, Math.min(100, score)));
}

async function findMatches(user, id) {
  const source = await findOwnedItem(user, id);
  if (!source.isOpen()) return [];

  const lat = Number(source.latitude);
  const lng = Number(source.longitude);
  const expr = distanceExpr(lat, lng);
  const eventDate = new Date(source.event_date);
  const dayMs = 86400000;

  const candidates = await Item.findAll({
    where: {
      type: source.type === 'lost' ? 'found' : 'lost',
      category_id: source.category_id,
      status: 'open',
      is_hidden: false,
      user_id: { [Op.ne]: user.id },
      event_date: {
        [Op.between]: [new Date(eventDate - MATCH_DAYS * dayMs), new Date(+eventDate + MATCH_DAYS * dayMs)],
      },
      ...boundingBox(lat, lng, MATCH_RADIUS_KM),
      [Op.and]: [sqlWhere(literal(expr), Op.lte, MATCH_RADIUS_KM * 1000)],
    },
    attributes: { include: [[literal(expr), 'distance_m']] },
    include: [categoryInclude, activeOwnerInclude, imagesInclude],
    order: [[literal('distance_m'), 'ASC']],
    limit: 50,
  });

  return candidates
    .map((c) => ({ ...serialize(c, user), match_score: matchScore(source, c) }))
    .sort((x, y) => y.match_score - x.match_score)
    .slice(0, 10);
}

// Used when an account is deleted: the DB cascade removes rows, we remove the files.
async function imageKeysForUser(userId) {
  const images = await ItemImage.findAll({
    attributes: ['storage_key'],
    include: [{ association: 'item', attributes: [], where: { user_id: userId }, required: true }],
  });
  return images.map((img) => img.storage_key);
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

const ADMIN_SORTS = {
  id: 'id',
  title: 'title',
  type: 'type',
  category: ['category', 'name'],
  status: 'status',
  posted: 'createdAt',
};
const EXPORT_LIMIT = 5000;

function adminWhere({ q, type, status, category, visibility }) {
  const where = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (category) where.category_id = category;
  if (visibility === 'hidden') where.is_hidden = true;
  if (visibility === 'visible') where.is_hidden = false;
  if (q) {
    const like = escapeLike(q);
    where[Op.or] = [{ title: { [Op.like]: like } }, { area_name: { [Op.like]: like } }];
    if (/^\d+$/.test(q)) where[Op.or].push({ id: Number(q) });
  }
  return where;
}

async function adminList({ page, limit, order = [['createdAt', 'DESC'], ['id', 'DESC']], ...filters }) {
  const { rows, count } = await Item.findAndCountAll({
    where: adminWhere(filters),
    include: [categoryInclude, { association: 'owner', attributes: ['id', 'name'] }, imagesInclude],
    order,
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { items: rows, total: count };
}

// Same filters and order as the admin table, without paging or photos.
async function adminExport({ order, ...filters }) {
  return Item.findAll({
    where: adminWhere(filters),
    include: [categoryInclude, { association: 'owner', attributes: ['id', 'name', 'email', 'phone'] }],
    order,
    limit: EXPORT_LIMIT,
  });
}

// Admin posting on behalf of the organisation (e.g. items handed in at a police station).
async function adminCreate(req, data, files) {
  const item = await createItem(req.admin, data, files);
  await AdminLog.record(req, 'item.create', { targetType: 'item', targetId: item.id, details: { title: item.title } });
  return item;
}

/**
 * Admin edit of any item: fields, photos (remove + add) and, for found items, the secret
 * question (only together with a new answer). Lost/found can't change — claims depend on it.
 * The owner is told when the team edits their post.
 */
async function adminUpdate(req, id, changes, files = [], removeImageIds = []) {
  const item = await Item.findByPk(id, { include: [imagesInclude, { association: 'owner', attributes: ['id', 'role'] }] });
  if (!item) throw ApiError.notFound('Item not found');

  if (changes.category_id !== undefined) await findCategory(changes.category_id);
  if (changes.secret_question !== undefined && item.type !== 'found') {
    throw ApiError.badRequest('Validation failed', [{ field: 'secret_question', message: 'Only found items have a secret question' }]);
  }

  const removing = item.images.filter((img) => removeImageIds.includes(img.id));
  const keptCount = item.images.length - removing.length;
  if (keptCount + files.length > MAX_IMAGES) {
    throw ApiError.badRequest('Validation failed', [
      { field: 'images', message: `An item can have up to ${MAX_IMAGES} photos (keeping ${keptCount}, adding ${files.length})` },
    ]);
  }

  const saved = await saveUploadedImages(files);
  const { secret_answer: answer, ...fields } = changes;
  if (fields.description === '') fields.description = null;
  try {
    await sequelize.transaction(async (transaction) => {
      await item.update({ ...fields, ...(answer && { secret_answer_hash: await Item.hashAnswer(answer) }) }, { transaction });
      if (removing.length) {
        await ItemImage.destroy({ where: { id: removing.map((img) => img.id), item_id: item.id }, transaction });
      }
      const lastOrder = item.images.reduce((max, img) => Math.max(max, img.sort_order), -1);
      await ItemImage.bulkCreate(
        saved.map((f, i) => ({ item_id: item.id, storage_key: f.key, url: f.url, width: f.width, height: f.height, sort_order: lastOrder + 1 + i })),
        { transaction },
      );
    });
  } catch (err) {
    await storage.removeFiles(saved.map((f) => f.key));
    throw err;
  }
  await storage.removeFiles(removing.map((img) => img.storage_key));

  await AdminLog.record(req, 'item.update', {
    targetType: 'item',
    targetId: item.id,
    details: {
      title: item.title,
      fields: Object.keys(fields).concat(answer ? ['secret_answer'] : []),
      photos_added: saved.length,
      photos_removed: removing.length,
    },
  });
  if (item.owner && item.owner.role !== 'admin') {
    await notify(item.user_id, {
      type: 'item.edited',
      title: 'Your post was updated',
      body: `Our team made changes to “${item.title}”. Tap to see your post.`,
      data: { item_id: item.id },
    });
  }
  return item;
}

async function adminGet(id) {
  const item = await Item.findByPk(id, {
    include: [categoryInclude, { association: 'owner', attributes: ['id', 'name', 'email', 'phone', 'is_blocked'] }, imagesInclude],
  });
  if (!item) throw ApiError.notFound('Item not found');

  const [history, claims] = await Promise.all([
    AdminLog.findAll({
      where: { target_type: 'item', target_id: id },
      include: [{ association: 'admin', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: 20,
    }),
    Claim.findAll({
      where: { item_id: id },
      include: [{ association: 'claimer', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
    }),
  ]);
  return { item, history, claims };
}

async function adminSetHidden(req, id, hidden, reason) {
  const item = await Item.findByPk(id);
  if (!item) throw ApiError.notFound('Item not found');
  if (item.is_hidden === hidden) return item;

  await item.update({ is_hidden: hidden, hidden_reason: hidden ? reason || null : null });
  await AdminLog.record(req, hidden ? 'item.hide' : 'item.unhide', {
    targetType: 'item',
    targetId: item.id,
    details: reason ? { reason } : null,
  });
  if (hidden && item.user_id !== req.session?.adminId) {
    await notify(item.user_id, {
      type: 'item.hidden',
      title: 'Your post was hidden',
      body: `“${item.title}” was hidden by our team.${reason ? ` Reason: ${reason}` : ''} Edit or contact support.`.slice(0, 500),
      data: { item_id: item.id },
    });
  }
  return item;
}

async function adminDelete(req, id, reason) {
  const item = await Item.findByPk(id, { include: [imagesInclude] });
  if (!item) throw ApiError.notFound('Item not found');

  const keys = item.images.map((img) => img.storage_key);
  await item.destroy();
  await storage.removeFiles(keys);
  await AdminLog.record(req, 'item.delete', {
    targetType: 'item',
    targetId: id,
    details: { title: item.title, owner_id: item.user_id, ...(reason && { reason }) },
  });
  return item;
}

async function stats() {
  const [lost, found, returned, hidden] = await Promise.all([
    Item.count({ where: { type: 'lost', status: 'open', is_hidden: false } }),
    Item.count({ where: { type: 'found', status: 'open', is_hidden: false } }),
    Item.count({ where: { status: 'returned' } }),
    Item.count({ where: { is_hidden: true } }),
  ]);
  return { lost, found, returned, hidden };
}

module.exports = {
  MAX_IMAGES,
  serialize,
  createItem,
  listItems,
  listMine,
  getItem,
  updateItem,
  addImages,
  deleteImage,
  closeItem,
  deleteItem,
  findMatches,
  imageKeysForUser,
  ADMIN_SORTS,
  adminList,
  adminExport,
  adminCreate,
  adminUpdate,
  adminGet,
  adminSetHidden,
  adminDelete,
  stats,
};

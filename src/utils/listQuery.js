const ROW_OPTIONS = [10, 20, 50, 100];

/**
 * Reads the common admin table params: ?q=&page=&limit=&sort=&dir=
 * `sorts` maps a public sort key to a Sequelize order column, e.g. { name: 'name', joined: 'createdAt' },
 * or to an association path like ['category', 'name'].
 * Unknown values fall back to defaults, so a hand-edited URL never errors.
 */
function parseListQuery(query, { sorts, defaultSort, defaultDir = 'desc', defaultLimit = 20 }) {
  const q = String(query.q || '').trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limitRaw = Number.parseInt(query.limit, 10);
  const limit = ROW_OPTIONS.includes(limitRaw) ? limitRaw : defaultLimit;
  const sort = Object.hasOwn(sorts, query.sort) ? query.sort : defaultSort;
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : defaultDir;

  const spec = sorts[sort];
  const order = [Array.isArray(spec) ? [...spec, dir.toUpperCase()] : [spec, dir.toUpperCase()]];
  if (spec !== 'id') order.push(['id', dir.toUpperCase()]);

  return { q, page, limit, sort, dir, order };
}

// Query-string values to keep in links (pagination, sorting), without empty ones.
function linkQuery(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

module.exports = { parseListQuery, linkQuery, ROW_OPTIONS };

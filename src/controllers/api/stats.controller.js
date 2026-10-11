const { Op } = require('sequelize');
const { Item, Claim } = require('../../models');
const { ok } = require('../../utils/response');

/** Community numbers for the app's home screen. Public, no personal data. */
async function summary(req, res) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const visibleToday = { is_hidden: false, createdAt: { [Op.gte]: startOfToday } };

  const [lostToday, foundToday, returnedWeek] = await Promise.all([
    Item.count({ where: { ...visibleToday, type: 'lost' } }),
    Item.count({ where: { ...visibleToday, type: 'found' } }),
    Claim.count({ where: { status: 'completed', completed_at: { [Op.gte]: weekAgo } } }),
  ]);
  return ok(res, { lost_today: lostToday, found_today: foundToday, returned_week: returnedWeek });
}

module.exports = { summary };

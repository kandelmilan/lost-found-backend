const { User, Category, AdminLog } = require('../../models');
const itemService = require('../../services/item.service');
const claimService = require('../../services/claim.service');
const reportService = require('../../services/report.service');

async function index(req, res) {
  const [totalUsers, blockedUsers, categories, recentLogs, items, claims, openReports] = await Promise.all([
    User.count({ where: { role: 'user' } }),
    User.count({ where: { role: 'user', is_blocked: true } }),
    Category.count({ where: { is_active: true } }),
    AdminLog.findAll({
      include: [{ association: 'admin', attributes: ['name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: 10,
    }),
    itemService.stats(),
    claimService.stats(),
    reportService.openCount(),
  ]);

  res.render('admin/pages/dashboard', {
    title: 'Dashboard',
    active: 'dashboard',
    stats: { totalUsers, blockedUsers, categories, ...items, ...claims, openReports },
    recentLogs,
  });
}

module.exports = { index };

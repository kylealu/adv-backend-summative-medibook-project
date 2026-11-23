const reportModel = require('../models/reportModel');
const { parseDate, MAX_APPOINTMENTS_PER_DAY } = require('../utils/slot');
const { badRequest } = require('../utils/errors');

const BUSY_THRESHOLD = 0.8; // "more than 80% of the 12-slot daily capacity"

// GET /api/reports/doctors
async function doctors(req, res) {
  res.json({ data: await reportModel.doctorsReport() });
}

// GET /api/reports/busy-days[?from=YYYY-MM-DD&to=YYYY-MM-DD]
async function busyDays(req, res) {
  const { from, to } = req.query;
  for (const [name, value] of Object.entries({ from, to })) {
    if (value !== undefined && (typeof value !== 'string' || !parseDate(value))) {
      throw badRequest(`${name} must be a date in YYYY-MM-DD format`);
    }
  }
  if (from && to && from > to) throw badRequest('from must be on or before to');

  const rows = await reportModel.busyDays({
    dailyCap: MAX_APPOINTMENTS_PER_DAY,
    threshold: BUSY_THRESHOLD,
    from,
    to,
  });
  res.json({
    meta: { daily_cap: MAX_APPOINTMENTS_PER_DAY, threshold_percent: BUSY_THRESHOLD * 100 },
    data: rows,
  });
}

module.exports = { doctors, busyDays };

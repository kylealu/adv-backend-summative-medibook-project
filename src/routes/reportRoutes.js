const { Router } = require('express');
const h = require('../middleware/asyncHandler');
const reports = require('../controllers/reportController');

const router = Router();

router.get('/doctors', h(reports.doctors));
router.get('/busy-days', h(reports.busyDays));

module.exports = router;

const { Router } = require('express');
const h = require('../middleware/asyncHandler');
const doctors = require('../controllers/doctorController');

const router = Router();

router.route('/')
  .get(h(doctors.list))
  .post(h(doctors.create));

router.route('/:id')
  .get(h(doctors.getOne))
  .put(h(doctors.update))
  .patch(h(doctors.update))
  .delete(h(doctors.remove));

router.get('/:id/stats', h(doctors.stats));
router.get('/:id/availability', h(doctors.availability));

router.route('/:id/waitlist')
  .get(h(doctors.getWaitlist))
  .post(h(doctors.joinWaitlist));
router.delete('/:id/waitlist/:patientId', h(doctors.leaveWaitlist));

module.exports = router;

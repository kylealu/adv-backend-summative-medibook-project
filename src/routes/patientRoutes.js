const { Router } = require('express');
const h = require('../middleware/asyncHandler');
const patients = require('../controllers/patientController');

const router = Router();

router.route('/')
  .get(h(patients.list))
  .post(h(patients.create));

router.route('/:id')
  .get(h(patients.getOne))
  .put(h(patients.update))
  .patch(h(patients.update))
  .delete(h(patients.remove));

router.get('/:id/appointments', h(patients.listAppointments));

module.exports = router;

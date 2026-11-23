const { Router } = require('express');
const h = require('../middleware/asyncHandler');
const appointments = require('../controllers/appointmentController');

const router = Router();

router.route('/')
  .get(h(appointments.list))
  .post(h(appointments.book));

router.route('/:id')
  .get(h(appointments.getOne))
  .delete(h(appointments.cancel)); // soft delete = cancellation with refund

module.exports = router;

const { Router } = require('express');
const h = require('../middleware/asyncHandler');
const appointments = require('../controllers/appointmentController');
const feedback = require('../controllers/feedbackController');

const api = Router();
api.use('/patients', require('./patientRoutes'));
api.use('/doctors', require('./doctorRoutes'));
api.use('/appointments', require('./appointmentRoutes'));
api.use('/reports', require('./reportRoutes'));
api.get('/waitlist/failed', h(appointments.failedWaitlist));

const pages = Router();
pages.get('/feedback', h(feedback.show));
pages.post('/feedback', h(feedback.submit));

module.exports = { api, pages };

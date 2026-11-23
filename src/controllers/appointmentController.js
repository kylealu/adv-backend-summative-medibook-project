const appointmentModel = require('../models/appointmentModel');
const bookingService = require('../services/bookingService');
const waitlistService = require('../services/waitlistService');
const queue = require('../services/queueService');
const { parseId } = require('../utils/validators');
const { parseDate } = require('../utils/slot');
const { HttpError, badRequest, notFound } = require('../utils/errors');

const BOOKING_FIELDS = ['patient_id', 'doctor_id', 'date', 'time', 'join_waitlist'];

function idParam(req) {
  const id = parseId(req.params.id);
  if (!id) throw badRequest('Appointment id must be a positive integer');
  return id;
}

function validateBookingBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }
  for (const key of Object.keys(body)) {
    if (!BOOKING_FIELDS.includes(key)) errors.push({ field: key, message: `Unknown field "${key}"` });
  }
  const patientId = parseId(body.patient_id);
  const doctorId = parseId(body.doctor_id);
  if (!patientId) errors.push({ field: 'patient_id', message: 'patient_id is required and must be a positive integer' });
  if (!doctorId) errors.push({ field: 'doctor_id', message: 'doctor_id is required and must be a positive integer' });
  if (typeof body.date !== 'string') errors.push({ field: 'date', message: 'date is required (YYYY-MM-DD)' });
  if (typeof body.time !== 'string') errors.push({ field: 'time', message: 'time is required (HH:MM)' });
  if (body.join_waitlist !== undefined && typeof body.join_waitlist !== 'boolean') {
    errors.push({ field: 'join_waitlist', message: 'join_waitlist must be true or false' });
  }
  return { errors, patientId, doctorId };
}

// POST /api/appointments  { patient_id, doctor_id, date, time, join_waitlist? }
async function book(req, res) {
  const { errors, patientId, doctorId } = validateBookingBody(req.body);
  if (errors.length) throw badRequest('Invalid booking request', errors);
  const { date, time, join_waitlist: joinWaitlist = false } = req.body;

  try {
    const appointment = await bookingService.bookAppointment({ patientId, doctorId, date, time });
    res.status(201).location(`/api/appointments/${appointment.id}`).json({ data: appointment });
  } catch (err) {
    const unavailable = err instanceof HttpError && (err.code === 'SLOT_TAKEN' || err.code === 'DOCTOR_DAY_FULL');
    if (!unavailable || !joinWaitlist) throw err; // 409 response carries the waitlist offer

    // The patient accepted the waitlist offer up-front: queue them instead.
    const { entry, position } = await waitlistService.joinWaitlist({
      patientId,
      doctorId,
      date,
      preferredTime: err.code === 'SLOT_TAKEN' ? time : null,
    });
    res.status(202).json({
      data: { waitlisted: true, reason: err.code, ...entry, position },
      message: `${err.message}. Added to the waitlist at position ${position}.`,
    });
  }
}

// GET /api/appointments[?doctor_id=&patient_id=&date=&status=]
async function list(req, res) {
  const filters = {};
  const { doctor_id: doctorId, patient_id: patientId, date, status } = req.query;
  if (doctorId !== undefined) {
    filters.doctorId = parseId(doctorId);
    if (!filters.doctorId) throw badRequest('doctor_id must be a positive integer');
  }
  if (patientId !== undefined) {
    filters.patientId = parseId(patientId);
    if (!filters.patientId) throw badRequest('patient_id must be a positive integer');
  }
  if (date !== undefined) {
    if (typeof date !== 'string' || !parseDate(date)) throw badRequest('date must be YYYY-MM-DD');
    filters.date = date;
  }
  if (status !== undefined) {
    const normalised = String(status).toUpperCase();
    if (!['BOOKED', 'CANCELLED'].includes(normalised)) throw badRequest('status must be BOOKED or CANCELLED');
    filters.status = normalised;
  }
  res.json({ data: await appointmentModel.findAll(filters) });
}

// GET /api/appointments/:id
async function getOne(req, res) {
  const id = idParam(req);
  const appointment = await appointmentModel.findById(id);
  if (!appointment) throw notFound(`Appointment ${id} not found`);
  res.json({ data: appointment });
}

// DELETE /api/appointments/:id  -> cancels (soft delete): row kept for refund history
async function cancel(req, res) {
  const id = idParam(req);
  const { appointment, refund } = await bookingService.cancelAppointment(id);
  res.json({
    data: appointment,
    refund: {
      hours_notice: Number(refund.hoursNotice.toFixed(2)),
      percent: refund.percent,
      amount: refund.amount,
      amount_paid: appointment.amount_paid,
    },
    message: `Appointment ${appointment.reference} cancelled. Refund: ${refund.amount.toFixed(2)} (${refund.percent}%).`,
  });
}

// GET /api/waitlist/failed  -> entries that could not be promoted (staff follow-up)
async function failedWaitlist(req, res) {
  try {
    res.json({ data: await queue.getFailedWaitlistEntries() });
  } catch (err) {
    throw waitlistService.serviceUnavailable(err);
  }
}

module.exports = { book, list, getOne, cancel, failedWaitlist };

const doctorModel = require('../models/doctorModel');
const appointmentModel = require('../models/appointmentModel');
const bookingService = require('../services/bookingService');
const waitlistService = require('../services/waitlistService');
const queue = require('../services/queueService');
const { validateDoctor, parseId } = require('../utils/validators');
const { parseDate, MAX_APPOINTMENTS_PER_DAY } = require('../utils/slot');
const { badRequest, notFound, conflict } = require('../utils/errors');

function idParam(req) {
  const id = parseId(req.params.id);
  if (!id) throw badRequest('Doctor id must be a positive integer');
  return id;
}

async function getExisting(id) {
  const doctor = await doctorModel.findById(id);
  if (!doctor) throw notFound(`Doctor ${id} not found`);
  return doctor;
}

async function assertEmailFree(email, exceptId) {
  const existing = await doctorModel.findByEmail(email);
  if (existing && existing.id !== exceptId) {
    throw conflict(`A doctor with email ${email} already exists`, undefined, 'DUPLICATE_EMAIL');
  }
}

function dateQuery(req, { required = true } = {}) {
  const { date } = req.query;
  if (date === undefined && !required) return null;
  if (typeof date !== 'string' || !parseDate(date)) {
    throw badRequest('Query parameter "date" is required in YYYY-MM-DD format');
  }
  return date;
}

// GET /api/doctors[?specialty=]
async function list(req, res) {
  const specialty = typeof req.query.specialty === 'string' ? req.query.specialty.trim() : undefined;
  res.json({ data: await doctorModel.findAll({ specialty }) });
}

// GET /api/doctors/:id
async function getOne(req, res) {
  res.json({ data: await getExisting(idParam(req)) });
}

// POST /api/doctors
async function create(req, res) {
  const { errors, value } = validateDoctor(req.body);
  if (errors.length) throw badRequest('Invalid doctor data', errors);
  await assertEmailFree(value.email);
  const doctor = await doctorModel.create(value);
  res.status(201).location(`/api/doctors/${doctor.id}`).json({ data: doctor });
}

// PUT /api/doctors/:id (full replace) and PATCH /api/doctors/:id (partial)
async function update(req, res) {
  const id = idParam(req);
  const { errors, value } = validateDoctor(req.body, { partial: req.method === 'PATCH' });
  if (errors.length) throw badRequest('Invalid doctor data', errors);
  await getExisting(id);
  if (value.email) await assertEmailFree(value.email, id);
  // A fee change only affects future bookings: past rows keep their amount_paid.
  res.json({ data: await doctorModel.update(id, value) });
}

// DELETE /api/doctors/:id
async function remove(req, res) {
  const id = idParam(req);
  await getExisting(id);
  const total = await doctorModel.countAppointments(id);
  if (total > 0) {
    throw conflict(
      `Doctor ${id} has ${total} appointment(s) on record and cannot be deleted`,
      { appointments: total },
      'HAS_APPOINTMENTS',
    );
  }
  await doctorModel.remove(id);
  res.status(204).end();
}

// GET /api/doctors/:id/stats
async function stats(req, res) {
  const id = idParam(req);
  const doctor = await getExisting(id);
  const nowDate = new Date();
  const clock = {
    dailyCap: MAX_APPOINTMENTS_PER_DAY,
    now: bookingService.toSqlDateTime(nowDate),
    today: waitlistService.todayString(nowDate),
  };
  const [summary, next7Days] = await Promise.all([
    doctorModel.getSummaryStats(id, clock),
    doctorModel.getNext7Days(id, clock),
  ]);
  res.json({
    data: {
      doctor_id: doctor.id,
      doctor_name: doctor.full_name,
      daily_cap: MAX_APPOINTMENTS_PER_DAY,
      ...summary,
      next_7_days: next7Days,
    },
  });
}

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
async function availability(req, res) {
  const id = idParam(req);
  const date = dateQuery(req);
  await getExisting(id);
  const booked = await appointmentModel.bookedTimesForDoctorDay(id, date);
  const free = await bookingService.availableSlots(id, date);
  res.json({
    data: {
      doctor_id: id,
      date,
      daily_cap: MAX_APPOINTMENTS_PER_DAY,
      booked_count: booked.length,
      day_full: booked.length >= MAX_APPOINTMENTS_PER_DAY,
      booked_slots: booked.map((t) => t.slice(0, 5)),
      available_slots: free,
    },
  });
}

// GET /api/doctors/:id/waitlist?date=YYYY-MM-DD
async function getWaitlist(req, res) {
  const id = idParam(req);
  const date = dateQuery(req);
  await getExisting(id);
  try {
    res.json({ data: { doctor_id: id, date, entries: await queue.getWaitlist(id, date) } });
  } catch (err) {
    throw waitlistService.serviceUnavailable(err);
  }
}

// POST /api/doctors/:id/waitlist  { patient_id, date, preferred_time? }
async function joinWaitlist(req, res) {
  const doctorId = idParam(req);
  const body = req.body || {};
  const patientId = parseId(body.patient_id);
  if (!patientId) throw badRequest('patient_id is required and must be a positive integer');
  if (typeof body.date !== 'string') throw badRequest('date is required in YYYY-MM-DD format');

  const { entry, position } = await waitlistService.joinWaitlist({
    patientId,
    doctorId,
    date: body.date,
    preferredTime: body.preferred_time ?? null,
  });
  res.status(201).json({
    data: { ...entry, position },
    message: `Added to the waitlist at position ${position}. You will be booked automatically when a slot frees up.`,
  });
}

// DELETE /api/doctors/:id/waitlist/:patientId?date=YYYY-MM-DD
async function leaveWaitlist(req, res) {
  const doctorId = idParam(req);
  const patientId = parseId(req.params.patientId);
  if (!patientId) throw badRequest('patientId must be a positive integer');
  const date = dateQuery(req);
  let removed;
  try {
    removed = await queue.leaveWaitlist(doctorId, date, patientId);
  } catch (err) {
    throw waitlistService.serviceUnavailable(err);
  }
  if (!removed) throw notFound(`Patient ${patientId} is not on the waitlist for doctor ${doctorId} on ${date}`);
  res.status(204).end();
}

module.exports = {
  list, getOne, create, update, remove, stats, availability, getWaitlist, joinWaitlist, leaveWaitlist,
};

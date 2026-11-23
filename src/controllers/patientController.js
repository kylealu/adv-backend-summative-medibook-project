const patientModel = require('../models/patientModel');
const appointmentModel = require('../models/appointmentModel');
const { validatePatient, parseId } = require('../utils/validators');
const { badRequest, notFound, conflict } = require('../utils/errors');

function idParam(req) {
  const id = parseId(req.params.id);
  if (!id) throw badRequest('Patient id must be a positive integer');
  return id;
}

async function getExisting(id) {
  const patient = await patientModel.findById(id);
  if (!patient) throw notFound(`Patient ${id} not found`);
  return patient;
}

async function assertEmailFree(email, exceptId) {
  const existing = await patientModel.findByEmail(email);
  if (existing && existing.id !== exceptId) {
    throw conflict(`A patient with email ${email} already exists`, undefined, 'DUPLICATE_EMAIL');
  }
}

// GET /api/patients
async function list(req, res) {
  res.json({ data: await patientModel.findAll() });
}

// GET /api/patients/:id
async function getOne(req, res) {
  res.json({ data: await getExisting(idParam(req)) });
}

// POST /api/patients
async function create(req, res) {
  const { errors, value } = validatePatient(req.body);
  if (errors.length) throw badRequest('Invalid patient data', errors);
  await assertEmailFree(value.email);
  const patient = await patientModel.create(value);
  res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
}

// PUT /api/patients/:id (full replace) and PATCH /api/patients/:id (partial)
async function update(req, res) {
  const id = idParam(req);
  const partial = req.method === 'PATCH';
  const { errors, value } = validatePatient(req.body, { partial });
  if (errors.length) throw badRequest('Invalid patient data', errors);
  await getExisting(id);
  if (value.email) await assertEmailFree(value.email, id);
  if (!partial && value.date_of_birth === undefined) value.date_of_birth = null; // PUT replaces everything
  res.json({ data: await patientModel.update(id, value) });
}

// DELETE /api/patients/:id
async function remove(req, res) {
  const id = idParam(req);
  await getExisting(id);
  // Appointment rows hold payment/refund history, so a patient with history is kept.
  const total = await patientModel.countAppointments(id);
  if (total > 0) {
    throw conflict(
      `Patient ${id} has ${total} appointment(s) on record and cannot be deleted`,
      { appointments: total },
      'HAS_APPOINTMENTS',
    );
  }
  await patientModel.remove(id);
  res.status(204).end();
}

// GET /api/patients/:id/appointments
async function listAppointments(req, res) {
  const id = idParam(req);
  await getExisting(id);
  res.json({ data: await appointmentModel.findAll({ patientId: id }) });
}

module.exports = { list, getOne, create, update, remove, listAppointments };

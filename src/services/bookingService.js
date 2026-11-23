/**
 * Booking and cancellation workflows. Shared by the HTTP controllers and
 * the waitlist worker so both enforce exactly the same rules.
 * No SQL here: every query goes through the models.
 */
const { withTransaction } = require('../config/db');
const doctorModel = require('../models/doctorModel');
const patientModel = require('../models/patientModel');
const appointmentModel = require('../models/appointmentModel');
const { validateSlot, toLocalDateTime, daySlots, MAX_APPOINTMENTS_PER_DAY } = require('../utils/slot');
const { calculateRefund } = require('../utils/refund');
const { HttpError, badRequest, notFound, conflict, unprocessable } = require('../utils/errors');
const { audit } = require('./auditLogger');
const queue = require('./queueService');

const pad = (n) => String(n).padStart(2, '0');
/** Date -> "YYYY-MM-DD HH:MM:SS" in local clinic time (matches the DB session time zone). */
function toSqlDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Free slot start times ("HH:MM") for a doctor on a date, or [] if the day is at the cap. */
async function availableSlots(doctorId, date, now = new Date()) {
  const booked = new Set(await appointmentModel.bookedTimesForDoctorDay(doctorId, date));
  if (booked.size >= MAX_APPOINTMENTS_PER_DAY) return [];
  return daySlots()
    .filter((slot) => !booked.has(slot) && validateSlot(date, slot, now).ok)
    .map((slot) => slot.slice(0, 5));
}

function waitlistOffer(doctorId, patientId, date, time) {
  return {
    available: true,
    message: 'This slot is not available. You can join the waitlist and be booked automatically when a slot frees up.',
    join: {
      method: 'POST',
      path: `/api/doctors/${doctorId}/waitlist`,
      body: { patient_id: patientId, date, preferred_time: time ? time.slice(0, 5) : null },
    },
  };
}

/**
 * Book an appointment. Throws HttpError on any rule violation.
 *
 * Concurrency (two requests for the same slot at the same instant):
 *  1. SELECT … FOR UPDATE on the doctor row serialises all bookings for that
 *     doctor, so the daily-cap count and the slot check cannot be raced.
 *  2. The UNIQUE (doctor_id, appt_date, appt_time, active_slot) index is the
 *     final guard: even if (1) were bypassed, MySQL rejects the second insert
 *     with ER_DUP_ENTRY, which we turn into 409 SLOT_TAKEN.
 */
async function bookAppointment({ patientId, doctorId, date, time }, { now = new Date(), source = 'api' } = {}) {
  const slot = validateSlot(date, time, now);
  if (!slot.ok) {
    if (slot.code === 'INVALID_FORMAT') throw badRequest(slot.message, [{ field: 'date/time', message: slot.message }]);
    throw unprocessable(slot.message, slot.code);
  }

  let appointment;
  try {
    appointment = await withTransaction(async (conn) => {
      // Lock order is always doctor -> patient, so concurrent bookings cannot deadlock.
      const doctor = await doctorModel.findByIdForUpdate(conn, doctorId);
      if (!doctor) throw notFound(`Doctor ${doctorId} not found`);
      const patient = await patientModel.findByIdForUpdate(conn, patientId);
      if (!patient) throw notFound(`Patient ${patientId} not found`);

      const bookedToday = await appointmentModel.countBookedForDoctorDay(conn, doctorId, slot.date);
      if (bookedToday >= MAX_APPOINTMENTS_PER_DAY) {
        throw conflict(
          `${doctor.full_name} already has the maximum of ${MAX_APPOINTMENTS_PER_DAY} appointments on ${slot.date}`,
          { waitlist: waitlistOffer(doctorId, patientId, slot.date, null) },
          'DOCTOR_DAY_FULL',
        );
      }

      if (await appointmentModel.isDoctorSlotBooked(conn, doctorId, slot.date, slot.time)) {
        throw conflict(
          `${doctor.full_name} is already booked at ${slot.date} ${slot.time.slice(0, 5)}`,
          { waitlist: waitlistOffer(doctorId, patientId, slot.date, slot.time) },
          'SLOT_TAKEN',
        );
      }

      if (await appointmentModel.isPatientBusyAt(conn, patientId, slot.date, slot.time)) {
        throw conflict(
          `Patient ${patientId} already has another appointment at ${slot.date} ${slot.time.slice(0, 5)}`,
          undefined,
          'PATIENT_DOUBLE_BOOKED',
        );
      }

      // amount_paid is the doctor's fee at the moment of booking (snapshot).
      const id = await appointmentModel.insert(conn, {
        patientId,
        doctorId,
        date: slot.date,
        time: slot.time,
        amountPaid: doctor.consultation_fee,
        bookedAt: toSqlDateTime(now),
      });
      return appointmentModel.findById(id, conn);
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw conflict(
        `Doctor ${doctorId} is already booked at ${slot.date} ${slot.time.slice(0, 5)}`,
        { waitlist: waitlistOffer(doctorId, patientId, slot.date, slot.time) },
        'SLOT_TAKEN',
      );
    }
    throw err;
  }

  // Side effects only after COMMIT. Neither may fail the booking.
  audit('APPOINTMENT_BOOKED', {
    source,
    appointmentId: appointment.id,
    reference: appointment.reference,
    patientId,
    doctorId,
    date: appointment.date,
    time: appointment.time,
    amountPaid: appointment.amount_paid,
  });
  await enqueueConfirmation(appointment);

  return appointment;
}

async function enqueueConfirmation(appointment) {
  try {
    await queue.enqueueJob(queue.JOB_TYPES.SEND_CONFIRMATION, {
      appointmentId: appointment.id,
      reference: appointment.reference,
      patientName: appointment.patient_name,
      email: appointment.patient_email,
      phone: appointment.patient_phone,
      doctorName: appointment.doctor_name,
      room: appointment.room,
      date: appointment.date,
      time: appointment.time,
    });
  } catch (err) {
    console.error(`[booking] could not enqueue confirmation for appointment ${appointment.id}: ${err.message}`);
    audit('NOTIFICATION_ENQUEUE_FAILED', { appointmentId: appointment.id, error: err.message });
  }
}

/**
 * Cancel an appointment and record its refund atomically.
 * The status change and the refund columns are written by one UPDATE inside
 * one transaction (with the row locked), so they succeed or fail together.
 */
async function cancelAppointment(appointmentId, { now = new Date() } = {}) {
  const { appointment, refund } = await withTransaction(async (conn) => {
    const current = await appointmentModel.findByIdForUpdate(conn, appointmentId);
    if (!current) throw notFound(`Appointment ${appointmentId} not found`);
    if (current.status === 'CANCELLED') {
      throw conflict(`Appointment ${appointmentId} is already cancelled`, undefined, 'ALREADY_CANCELLED');
    }

    const start = toLocalDateTime(current.date, current.time);
    if (start.getTime() <= now.getTime()) {
      throw unprocessable('Appointments that have already started or taken place cannot be cancelled', 'APPOINTMENT_IN_PAST');
    }

    const result = calculateRefund(Number(current.amount_paid), start, now);
    const updated = await appointmentModel.markCancelled(conn, appointmentId, {
      cancelledAt: toSqlDateTime(now),
      refundPercent: result.percent,
      refundAmount: result.amount,
    });
    if (!updated) throw new HttpError(409, 'Appointment changed while cancelling, try again', { code: 'CONCURRENT_UPDATE' });

    return { appointment: await appointmentModel.findById(appointmentId, conn), refund: result };
  });

  audit('APPOINTMENT_CANCELLED', {
    appointmentId: appointment.id,
    reference: appointment.reference,
    patientId: appointment.patient_id,
    doctorId: appointment.doctor_id,
    date: appointment.date,
    time: appointment.time,
    hoursNotice: Number(refund.hoursNotice.toFixed(2)),
    refundPercent: refund.percent,
    refundAmount: refund.amount,
  });

  // Tell the worker a slot is free so it can promote someone from the waitlist.
  // If Redis is down the worker's periodic sweep will still find the free slot.
  try {
    await queue.enqueueJob(queue.JOB_TYPES.SLOT_FREED, {
      doctorId: appointment.doctor_id,
      date: appointment.date,
      time: `${appointment.time}:00`,
    });
  } catch (err) {
    console.error(`[cancel] could not notify waitlist for appointment ${appointment.id}: ${err.message}`);
  }

  return { appointment, refund };
}

module.exports = { bookAppointment, cancelAppointment, availableSlots, toSqlDateTime };

/**
 * Waitlist rules: joining (API) and promotion (worker).
 *
 * Promotion is "book first, then dequeue":
 *   1. read the waitlist (oldest first) and pick the first eligible entry
 *   2. record it in the in-flight list (crash marker)
 *   3. try to book it through bookingService (same rules as the API)
 *   4. only if the booking COMMITTED, remove the entry from the waitlist
 * So if step 3 fails the patient is still on the waitlist (transient error
 * or the slot was grabbed again) or is moved to the dead-letter list with a
 * reason (permanent error) — never simply lost.
 */
const doctorModel = require('../models/doctorModel');
const patientModel = require('../models/patientModel');
const appointmentModel = require('../models/appointmentModel');
const bookingService = require('./bookingService');
const queue = require('./queueService');
const { audit } = require('./auditLogger');
const { validateSlot, parseDate, toLocalDateTime, formatDate } = require('../utils/slot');
const { HttpError, badRequest, notFound, conflict, unprocessable } = require('../utils/errors');

const LOCK_TTL_MS = 30_000;

function todayString(now = new Date()) {
  return formatDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

function serviceUnavailable(err) {
  return new HttpError(503, 'The waitlist is temporarily unavailable, please try again shortly', {
    code: 'WAITLIST_UNAVAILABLE',
    details: { reason: err.message },
  });
}

/**
 * Validate and add a patient to a doctor-day waitlist (API side).
 * Only allowed when what they asked for is actually unavailable.
 */
async function joinWaitlist({ patientId, doctorId, date, preferredTime }, { now = new Date() } = {}) {
  if (!parseDate(date)) throw badRequest('date must be a valid date in YYYY-MM-DD format');
  if (date < todayString(now)) throw unprocessable('Cannot join a waitlist for a past date', 'IN_PAST');

  let time = null;
  if (preferredTime !== undefined && preferredTime !== null) {
    const slot = validateSlot(date, preferredTime, now);
    if (!slot.ok) {
      if (slot.code === 'INVALID_FORMAT') throw badRequest(slot.message);
      throw unprocessable(slot.message, slot.code);
    }
    time = slot.time;
  }

  const [doctor, patient] = await Promise.all([doctorModel.findById(doctorId), patientModel.findById(patientId)]);
  if (!doctor) throw notFound(`Doctor ${doctorId} not found`);
  if (!patient) throw notFound(`Patient ${patientId} not found`);

  const free = await bookingService.availableSlots(doctorId, date, now);
  if (time ? free.includes(time.slice(0, 5)) : free.length > 0) {
    throw conflict(
      time ? 'That slot is free, book it directly instead of joining the waitlist'
        : 'This doctor still has free slots that day, book one directly',
      { available_slots: free },
      'SLOT_AVAILABLE',
    );
  }

  let result;
  try {
    result = await queue.joinWaitlist({ patientId, doctorId, date, preferredTime: time });
  } catch (err) {
    throw serviceUnavailable(err);
  }
  if (result.duplicate) {
    throw conflict(`Patient ${patientId} is already on this waitlist`, undefined, 'ALREADY_WAITLISTED');
  }

  audit('WAITLIST_JOINED', { ...result.entry, position: result.position });
  return result;
}

/**
 * Worker side: a slot (doctorId, date, time "HH:MM:00") is free — give it to
 * the first eligible waitlisted patient. Returns a small outcome object.
 * Throws only on transient errors (DB/Redis down) so the job is retried.
 */
async function promoteForSlot(doctorId, date, time, { now = new Date() } = {}) {
  if (!validateSlot(date, time, now).ok) return { promoted: false, reason: 'SLOT_NOT_BOOKABLE' };

  const outcome = await queue.withLock(`waitlist:${doctorId}:${date}`, LOCK_TTL_MS, async () => {
    const entries = await queue.getWaitlistRaw(doctorId, date);

    for (const raw of entries) {
      const entry = JSON.parse(raw);
      if (entry.preferredTime && entry.preferredTime !== time) continue; // wants a different slot

      await queue.markInflight(raw);
      try {
        const appointment = await bookingService.bookAppointment(
          { patientId: entry.patientId, doctorId, date, time },
          { now, source: 'waitlist' },
        );
        await queue.removeWaitlistEntry(raw); // only after the booking committed
        audit('WAITLIST_PROMOTED', {
          waitlistEntryId: entry.id,
          patientId: entry.patientId,
          doctorId,
          date,
          time,
          appointmentId: appointment.id,
        });
        return { promoted: true, appointmentId: appointment.id, patientId: entry.patientId };
      } catch (err) {
        const code = err instanceof HttpError ? err.code : null;

        if (code === 'SLOT_TAKEN' || code === 'DOCTOR_DAY_FULL') {
          // Someone booked it first. Entry stays where it is, in the same position.
          return { promoted: false, reason: code };
        }
        if (code === 'PATIENT_DOUBLE_BOOKED') {
          // This patient is busy at that time — keep them waiting, offer the slot to the next one.
          audit('WAITLIST_SKIPPED', { waitlistEntryId: entry.id, patientId: entry.patientId, doctorId, date, time, reason: code });
          continue;
        }
        if (err instanceof HttpError && err.status < 500) {
          // Permanent for this entry (e.g. patient or doctor deleted): park it in the
          // dead-letter list with the reason so staff can follow up.
          await queue.failWaitlistEntry(raw, code || err.message);
          audit('WAITLIST_PROMOTION_FAILED', {
            waitlistEntryId: entry.id, patientId: entry.patientId, doctorId, date, time, reason: code || err.message,
          });
          continue;
        }
        throw err; // transient: entry untouched on the waitlist, job will be retried
      } finally {
        await queue.clearInflight(raw);
      }
    }
    return { promoted: false, reason: 'NO_ELIGIBLE_ENTRY' };
  });

  if (outcome.locked) return { promoted: false, reason: 'LOCKED_BY_ANOTHER_WORKER' };
  return outcome.result;
}

/**
 * Safety net run periodically by the worker:
 *  - expires entries whose date (or preferred time) has passed -> dead-letter list
 *  - for every remaining waitlist, tries to fill any free slot
 * This also covers a SLOT_FREED job that was lost (e.g. Redis briefly down at cancel time).
 */
async function sweep({ now = new Date() } = {}) {
  const results = [];
  const keys = await queue.listWaitlistKeys();
  const today = todayString(now);

  for (const { doctorId, date } of keys) {
    const entries = await queue.getWaitlistRaw(doctorId, date);
    for (const raw of entries) {
      const entry = JSON.parse(raw);
      const expired = date < today
        || (entry.preferredTime && toLocalDateTime(date, entry.preferredTime) <= now);
      if (expired) {
        await queue.failWaitlistEntry(raw, 'EXPIRED');
        audit('WAITLIST_EXPIRED', { waitlistEntryId: entry.id, patientId: entry.patientId, doctorId, date });
      }
    }
    if (date < today) continue;

    const free = await bookingService.availableSlots(doctorId, date, now);
    for (const slot of free) {
      const result = await promoteForSlot(doctorId, date, `${slot}:00`, { now });
      if (result.promoted) results.push({ doctorId, date, time: slot, ...result });
    }
  }
  return results;
}

/**
 * Worker start-up: entries left "in flight" by a crashed worker. If their booking
 * actually committed, finish the job by removing them from the waitlist;
 * otherwise they are still on the waitlist and will simply be tried again.
 */
async function recoverInflight() {
  const inflight = await queue.getInflight();
  for (const raw of inflight) {
    const entry = JSON.parse(raw);
    const joined = new Date(entry.joinedAt);
    const booked = await appointmentModel.findBookedForPatientDoctorDay(
      entry.patientId,
      entry.doctorId,
      entry.date,
      bookingService.toSqlDateTime(joined),
    );
    if (booked) {
      await queue.removeWaitlistEntry(raw);
      audit('WAITLIST_RECOVERED', { waitlistEntryId: entry.id, patientId: entry.patientId, appointmentId: booked.id });
    }
    await queue.clearInflight(raw);
  }
  return inflight.length;
}

module.exports = { joinWaitlist, promoteForSlot, sweep, recoverInflight, serviceUnavailable, todayString };

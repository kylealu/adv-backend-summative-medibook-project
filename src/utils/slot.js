/**
 * Pure date/slot helpers — no DB, no Redis, so they are unit-testable.
 *
 * Clinic rules:
 *   - working hours 09:00–17:00, 30-minute slots => slots start 09:00 … 16:30
 *     (a 17:00 appointment would end at 17:30, outside working hours)
 *   - max 12 appointments per doctor per day
 * All times are clinic-local wall-clock times.
 */
const SLOT_MINUTES = 30;
const DAY_START_MINUTES = 9 * 60; // 09:00
const DAY_END_MINUTES = 17 * 60; // 17:00 (closing time)
const MAX_APPOINTMENTS_PER_DAY = 12;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-08-10" -> { y, m, d } or null if malformed / not a real calendar date. */
function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

/** "09:30" or "09:30:00" -> { hh, mm, ss } or null if malformed. */
function parseTime(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] === undefined ? 0 : Number(match[3]);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { hh, mm, ss };
}

const pad = (n) => String(n).padStart(2, '0');
const formatDate = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const formatTime = ({ hh, mm, ss = 0 }) => `${pad(hh)}:${pad(mm)}:${pad(ss)}`;

/** Local Date for a clinic date + time. */
function toLocalDateTime(dateStr, timeStr) {
  const date = parseDate(dateStr);
  const time = parseTime(timeStr);
  if (!date || !time) return null;
  return new Date(date.y, date.m - 1, date.d, time.hh, time.mm, time.ss);
}

/** Every bookable slot start of a working day: ["09:00:00", …, "16:30:00"]. */
function daySlots() {
  const slots = [];
  for (let t = DAY_START_MINUTES; t + SLOT_MINUTES <= DAY_END_MINUTES; t += SLOT_MINUTES) {
    slots.push(formatTime({ hh: Math.floor(t / 60), mm: t % 60 }));
  }
  return slots;
}

/**
 * Validate a requested appointment slot.
 * Returns { ok: true, date, time, start } with normalised "YYYY-MM-DD" / "HH:MM:00",
 * or { ok: false, code, message } where code is one of:
 *   INVALID_FORMAT        -> malformed input           (HTTP 400)
 *   OUTSIDE_WORKING_HOURS -> before 09:00 / 16:30 onward is closed  (HTTP 422)
 *   NOT_ON_SLOT_BOUNDARY  -> not :00 or :30           (HTTP 422)
 *   IN_PAST               -> not strictly in the future (HTTP 422)
 */
function validateSlot(dateStr, timeStr, now = new Date()) {
  const date = parseDate(dateStr);
  if (!date) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'date must be a valid calendar date in YYYY-MM-DD format' };
  }
  const time = parseTime(timeStr);
  if (!time) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'time must be a valid time in HH:MM (24-hour) format' };
  }

  const minutes = time.hh * 60 + time.mm;
  if (time.ss !== 0 || minutes % SLOT_MINUTES !== 0) {
    return {
      ok: false,
      code: 'NOT_ON_SLOT_BOUNDARY',
      message: `Appointments start on ${SLOT_MINUTES}-minute boundaries (e.g. 09:00, 09:30)`,
    };
  }
  if (minutes < DAY_START_MINUTES || minutes + SLOT_MINUTES > DAY_END_MINUTES) {
    return {
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      message: 'Appointments must be within working hours 09:00–17:00 (last slot starts at 16:30)',
    };
  }

  const start = new Date(date.y, date.m - 1, date.d, time.hh, time.mm, 0);
  if (start.getTime() <= now.getTime()) {
    return { ok: false, code: 'IN_PAST', message: 'Appointments can only be booked in the future' };
  }

  return { ok: true, date: formatDate(date), time: formatTime(time), start };
}

module.exports = {
  SLOT_MINUTES,
  MAX_APPOINTMENTS_PER_DAY,
  parseDate,
  parseTime,
  formatDate,
  formatTime,
  toLocalDateTime,
  daySlots,
  validateSlot,
};

/**
 * Refund policy (pure function, unit-tested in tests/refund.test.js).
 *
 *   notice  > 48 hours          -> 100 %
 *   24 h <= notice <= 48 hours  ->  50 %   (both boundaries belong to the middle tier)
 *   notice  < 24 hours          ->   0 %
 *
 * "notice" = time between the cancellation and the appointment start.
 * Exactly 48h is NOT "more than 48 hours", so it gets 50 %; exactly 24h is
 * inside "24–48 hours", so it also gets 50 %.
 */
const HOUR_MS = 60 * 60 * 1000;
const FULL_REFUND_MIN_HOURS = 48; // notice must be MORE than this for 100 %
const HALF_REFUND_MIN_HOURS = 24; // notice of at least this gets 50 %
const FULL_REFUND_PERCENT = 100;
const HALF_REFUND_PERCENT = 50;
const NO_REFUND_PERCENT = 0;

function refundPercentForNotice(hoursNotice) {
  if (typeof hoursNotice !== 'number' || Number.isNaN(hoursNotice)) {
    throw new TypeError('hoursNotice must be a number');
  }
  if (hoursNotice > FULL_REFUND_MIN_HOURS) return FULL_REFUND_PERCENT;
  if (hoursNotice >= HALF_REFUND_MIN_HOURS) return HALF_REFUND_PERCENT;
  return NO_REFUND_PERCENT;
}

/**
 * @param {number} amountPaid  amount the patient paid, e.g. 150 or 120.5
 * @param {Date}   appointmentStart
 * @param {Date}   [cancelledAt=new Date()]
 * @returns {{ hoursNotice: number, percent: 0|50|100, amount: number }}
 */
function calculateRefund(amountPaid, appointmentStart, cancelledAt = new Date()) {
  if (typeof amountPaid !== 'number' || Number.isNaN(amountPaid) || amountPaid < 0) {
    throw new TypeError('amountPaid must be a non-negative number');
  }
  if (!(appointmentStart instanceof Date) || Number.isNaN(appointmentStart.getTime())) {
    throw new TypeError('appointmentStart must be a valid Date');
  }
  const hoursNotice = (appointmentStart.getTime() - cancelledAt.getTime()) / HOUR_MS;
  const percent = refundPercentForNotice(hoursNotice);
  // Work in integer cents to avoid floating-point drift (e.g. 50% of 100.01).
  const cents = Math.round(amountPaid * 100);
  const amount = Math.round((cents * percent) / 100) / 100;
  return { hoursNotice, percent, amount };
}

module.exports = { refundPercentForNotice, calculateRefund };

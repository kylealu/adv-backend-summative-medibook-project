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

function refundPercentForNotice(hoursNotice) {
  if (typeof hoursNotice !== 'number' || Number.isNaN(hoursNotice)) {
    throw new TypeError('hoursNotice must be a number');
  }
  if (hoursNotice > 48) return 100;
  if (hoursNotice >= 24) return 50;
  return 0;
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

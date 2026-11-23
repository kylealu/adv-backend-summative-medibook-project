/** Clinic-wide reports. All aggregation happens in SQL. */
const { pool } = require('../config/db');

/**
 * Every doctor's totals, INCLUDING doctors with no appointments
 * (LEFT JOIN keeps them; COALESCE turns their NULL sums into 0).
 *   total_appointments = appointments currently booked (not cancelled)
 *   revenue_collected  = amount paid minus refunds given
 */
async function doctorsReport() {
  const [rows] = await pool.execute(
    `SELECT
       d.id                                                             AS doctor_id,
       d.full_name                                                      AS doctor_name,
       d.specialty,
       COALESCE(SUM(a.status = 'BOOKED'), 0)                            AS total_appointments,
       COALESCE(SUM(a.status = 'CANCELLED'), 0)                         AS cancelled_appointments,
       COALESCE(SUM(a.amount_paid), 0)                                  AS gross_paid,
       COALESCE(SUM(a.refund_amount), 0)                                AS total_refunded,
       COALESCE(SUM(a.amount_paid - COALESCE(a.refund_amount, 0)), 0)   AS revenue_collected
     FROM doctors d
     LEFT JOIN appointments a ON a.doctor_id = d.id
     GROUP BY d.id, d.full_name, d.specialty
     ORDER BY revenue_collected DESC, d.id`,
  );
  return rows;
}

/**
 * Every (doctor, date) where booked appointments exceed `threshold` (0.8)
 * of the daily cap. With a cap of 12 that means 10 or more bookings.
 * Optional from/to bound the date range. Only fixed SQL fragments are concatenated.
 */
async function busyDays({ dailyCap, threshold, from, to }) {
  const where = ["a.status = 'BOOKED'"];
  const params = [dailyCap];
  if (from) { where.push('a.appt_date >= ?'); params.push(from); }
  if (to) { where.push('a.appt_date <= ?'); params.push(to); }
  params.push(dailyCap * threshold);

  const [rows] = await pool.execute(
    `SELECT
       d.id                                     AS doctor_id,
       d.full_name                              AS doctor_name,
       d.specialty,
       DATE_FORMAT(a.appt_date, '%Y-%m-%d')     AS date,
       COUNT(*)                                 AS booked,
       ROUND(COUNT(*) / ? * 100, 1)             AS utilization_percent
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     WHERE ${where.join(' AND ')}
     GROUP BY d.id, d.full_name, d.specialty, a.appt_date
     HAVING COUNT(*) > ?
     ORDER BY a.appt_date, d.id`,
    params,
  );
  return rows;
}

module.exports = { doctorsReport, busyDays };

/** All SQL for the `doctors` table, including per-doctor statistics. */
const { pool } = require('../config/db');

const COLUMNS = 'id, full_name, email, specialty, consultation_fee, room, created_at, updated_at';
const WRITABLE = ['full_name', 'email', 'specialty', 'consultation_fee', 'room'];

async function findAll({ specialty } = {}) {
  if (specialty) {
    const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM doctors WHERE specialty = ? ORDER BY id`, [specialty]);
    return rows;
  }
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM doctors ORDER BY id`);
  return rows;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM doctors WHERE id = ?`, [id]);
  return rows[0] || null;
}

/**
 * Locks the doctor row until the transaction ends. Every booking for this
 * doctor takes this lock first, so the "max 12 per day" count cannot be
 * raced by two concurrent requests.
 */
async function findByIdForUpdate(conn, id) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM doctors WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM doctors WHERE email = ?`, [email]);
  return rows[0] || null;
}

async function create({ full_name, email, specialty, consultation_fee, room }) {
  const [result] = await pool.execute(
    'INSERT INTO doctors (full_name, email, specialty, consultation_fee, room) VALUES (?, ?, ?, ?, ?)',
    [full_name, email, specialty, consultation_fee, room],
  );
  return findById(result.insertId);
}

async function update(id, fields) {
  const keys = WRITABLE.filter((key) => fields[key] !== undefined);
  if (keys.length > 0) {
    // Column names come from the fixed WRITABLE list; values are bound with ?.
    const setClause = keys.map((key) => `${key} = ?`).join(', ');
    await pool.execute(`UPDATE doctors SET ${setClause} WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
  }
  return findById(id);
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM doctors WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function countAppointments(id) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM appointments WHERE doctor_id = ?', [id]);
  return rows[0].total;
}

/**
 * Headline statistics for one doctor, computed entirely in SQL:
 *  - revenue_collected: money kept = amount paid minus refunds given
 *  - upcoming_appointments: booked and starting after now
 *  - next-7-days utilisation against the daily cap (12 x 7 slots)
 */
// `now` ("YYYY-MM-DD HH:MM:SS") and `today` ("YYYY-MM-DD") are passed in from
// Node so SQL and JavaScript always agree on the clinic's local time.
async function getSummaryStats(id, { dailyCap, now, today }) {
  const [rows] = await pool.execute(
    `SELECT
       COALESCE(SUM(a.amount_paid - COALESCE(a.refund_amount, 0)), 0)       AS revenue_collected,
       COALESCE(SUM(a.refund_amount), 0)                                     AS total_refunded,
       COALESCE(SUM(a.status = 'BOOKED'
                    AND TIMESTAMP(a.appt_date, a.appt_time) > CAST(? AS DATETIME)), 0)
                                                                             AS upcoming_appointments,
       COALESCE(SUM(a.status = 'BOOKED'
                    AND a.appt_date BETWEEN w.start_day AND w.start_day + INTERVAL 6 DAY), 0)
                                                                             AS booked_next_7_days,
       ROUND(
         COALESCE(SUM(a.status = 'BOOKED'
                      AND a.appt_date BETWEEN w.start_day AND w.start_day + INTERVAL 6 DAY), 0)
         / (? * 7) * 100, 1)                                                 AS utilization_next_7_days_percent
     FROM (SELECT CAST(? AS DATE) AS start_day) w
     LEFT JOIN appointments a ON a.doctor_id = ?`,
    [now, dailyCap, today, id],
  );
  return rows[0];
}

/**
 * Appointments per day for today + the next 6 days. A recursive CTE
 * generates all 7 dates so days with zero bookings still appear.
 */
async function getNext7Days(id, { dailyCap, today }) {
  const [rows] = await pool.execute(
    `WITH RECURSIVE days (day, n) AS (
       SELECT CAST(? AS DATE), 0
       UNION ALL
       SELECT day + INTERVAL 1 DAY, n + 1 FROM days WHERE n < 6
     )
     SELECT
       DATE_FORMAT(days.day, '%Y-%m-%d')   AS date,
       COUNT(a.id)                          AS appointments,
       ? - COUNT(a.id)                      AS slots_remaining,
       ROUND(COUNT(a.id) / ? * 100, 1)      AS utilization_percent
     FROM days
     LEFT JOIN appointments a
       ON a.appt_date = days.day
      AND a.doctor_id = ?
      AND a.status = 'BOOKED'
     GROUP BY days.day
     ORDER BY days.day`,
    [today, dailyCap, dailyCap, id],
  );
  return rows;
}

module.exports = {
  findAll,
  findById,
  findByIdForUpdate,
  findByEmail,
  create,
  update,
  remove,
  countAppointments,
  getSummaryStats,
  getNext7Days,
};

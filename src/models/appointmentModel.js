/** All SQL for the `appointments` table. Every query is parameterized. */
const { pool } = require('../config/db');

// Joined view used for API responses. `reference` reproduces the old "AP-001" style.
const SELECT_DETAILED = `
  SELECT
    a.id,
    CONCAT('AP-', LPAD(a.id, 3, '0'))       AS reference,
    a.patient_id,
    p.full_name                              AS patient_name,
    p.email                                  AS patient_email,
    p.phone                                  AS patient_phone,
    a.doctor_id,
    d.full_name                              AS doctor_name,
    d.specialty,
    d.room,
    DATE_FORMAT(a.appt_date, '%Y-%m-%d')    AS date,
    TIME_FORMAT(a.appt_time, '%H:%i')       AS time,
    a.status,
    a.amount_paid,
    a.booked_at,
    a.cancelled_at,
    a.refund_percent,
    a.refund_amount
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctors  d ON d.id = a.doctor_id`;

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`${SELECT_DETAILED} WHERE a.id = ?`, [id]);
  return rows[0] || null;
}

/** Optional filters: doctorId, patientId, date, status. Only fixed SQL fragments are concatenated. */
async function findAll({ doctorId, patientId, date, status } = {}) {
  const where = [];
  const params = [];
  if (doctorId) { where.push('a.doctor_id = ?'); params.push(doctorId); }
  if (patientId) { where.push('a.patient_id = ?'); params.push(patientId); }
  if (date) { where.push('a.appt_date = ?'); params.push(date); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `${SELECT_DETAILED} ${whereSql} ORDER BY a.appt_date, a.appt_time, a.id`,
    params,
  );
  return rows;
}

/** Row lock on one appointment for the cancellation transaction. */
async function findByIdForUpdate(conn, id) {
  const [rows] = await conn.execute(
    `SELECT id, patient_id, doctor_id,
            DATE_FORMAT(appt_date, '%Y-%m-%d') AS date,
            TIME_FORMAT(appt_time, '%H:%i:%s') AS time,
            status, amount_paid
       FROM appointments WHERE id = ? FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

async function countBookedForDoctorDay(conn, doctorId, date) {
  const [rows] = await conn.execute(
    "SELECT COUNT(*) AS total FROM appointments WHERE doctor_id = ? AND appt_date = ? AND status = 'BOOKED'",
    [doctorId, date],
  );
  return rows[0].total;
}

async function isDoctorSlotBooked(conn, doctorId, date, time) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM appointments
      WHERE doctor_id = ? AND appt_date = ? AND appt_time = ? AND status = 'BOOKED' LIMIT 1`,
    [doctorId, date, time],
  );
  return rows.length > 0;
}

async function isPatientBusyAt(conn, patientId, date, time) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM appointments
      WHERE patient_id = ? AND appt_date = ? AND appt_time = ? AND status = 'BOOKED' LIMIT 1`,
    [patientId, date, time],
  );
  return rows.length > 0;
}

/** Start times ("HH:MM:00") already booked for a doctor on a date. */
async function bookedTimesForDoctorDay(doctorId, date, conn = pool) {
  const [rows] = await conn.execute(
    `SELECT TIME_FORMAT(appt_time, '%H:%i:%s') AS time FROM appointments
      WHERE doctor_id = ? AND appt_date = ? AND status = 'BOOKED' ORDER BY appt_time`,
    [doctorId, date],
  );
  return rows.map((row) => row.time);
}

/**
 * Booked appointment for this patient with this doctor on this date, created
 * at or after `bookedSince` (worker crash recovery: "did my promotion commit?").
 */
async function findBookedForPatientDoctorDay(patientId, doctorId, date, bookedSince) {
  const [rows] = await pool.execute(
    `SELECT id FROM appointments
      WHERE patient_id = ? AND doctor_id = ? AND appt_date = ? AND status = 'BOOKED'
        AND booked_at >= ?
      LIMIT 1`,
    [patientId, doctorId, date, bookedSince],
  );
  return rows[0] || null;
}

async function insert(conn, { patientId, doctorId, date, time, amountPaid, bookedAt }) {
  const [result] = await conn.execute(
    `INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, amount_paid, booked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [patientId, doctorId, date, time, amountPaid, bookedAt],
  );
  return result.insertId;
}

/**
 * Cancel + record the refund in ONE statement inside the caller's transaction.
 * `status = 'BOOKED'` in the WHERE makes a double cancel a no-op (affectedRows 0).
 */
async function markCancelled(conn, id, { cancelledAt, refundPercent, refundAmount }) {
  const [result] = await conn.execute(
    `UPDATE appointments
        SET status = 'CANCELLED', cancelled_at = ?, refund_percent = ?, refund_amount = ?
      WHERE id = ? AND status = 'BOOKED'`,
    [cancelledAt, refundPercent, refundAmount, id],
  );
  return result.affectedRows === 1;
}

module.exports = {
  findById,
  findAll,
  findByIdForUpdate,
  countBookedForDoctorDay,
  isDoctorSlotBooked,
  isPatientBusyAt,
  bookedTimesForDoctorDay,
  findBookedForPatientDoctorDay,
  insert,
  markCancelled,
};

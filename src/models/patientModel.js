/** All SQL for the `patients` table. Every query is parameterized. */
const { pool } = require('../config/db');

const COLUMNS = 'id, full_name, email, phone, date_of_birth, created_at, updated_at';
// Whitelist of columns a client may set; keys come from the validator, never raw input.
const WRITABLE = ['full_name', 'email', 'phone', 'date_of_birth'];

async function findAll() {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM patients ORDER BY id`);
  return rows;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM patients WHERE id = ?`, [id]);
  return rows[0] || null;
}

/** Locks the patient row until the transaction ends (serialises a patient's bookings). */
async function findByIdForUpdate(conn, id) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM patients WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM patients WHERE email = ?`, [email]);
  return rows[0] || null;
}

async function create({ full_name, email, phone, date_of_birth = null }) {
  const [result] = await pool.execute(
    'INSERT INTO patients (full_name, email, phone, date_of_birth) VALUES (?, ?, ?, ?)',
    [full_name, email, phone, date_of_birth],
  );
  return findById(result.insertId);
}

async function update(id, fields) {
  const keys = WRITABLE.filter((key) => fields[key] !== undefined);
  if (keys.length > 0) {
    // Column names come from the fixed WRITABLE list; values are bound with ?.
    const setClause = keys.map((key) => `${key} = ?`).join(', ');
    await pool.execute(`UPDATE patients SET ${setClause} WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
  }
  return findById(id);
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM patients WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function countAppointments(id) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM appointments WHERE patient_id = ?', [id]);
  return rows[0].total;
}

module.exports = { findAll, findById, findByIdForUpdate, findByEmail, create, update, remove, countAppointments };

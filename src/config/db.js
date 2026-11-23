const mysql = require('mysql2/promise');
const { db } = require('./env');

const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: 10,
  // Return DATE/DATETIME as plain strings ("2026-08-10") so no timezone
  // shifting happens between MySQL and JavaScript Date objects.
  dateStrings: true,
  decimalNumbers: true,
});

/**
 * Run `work(conn)` inside a transaction on a dedicated connection.
 * Commits if `work` resolves, rolls back if it throws, always releases.
 */
async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };

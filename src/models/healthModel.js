/** Connectivity check — kept in models so no SQL lives outside this folder. */
const { pool } = require('../config/db');

async function ping() {
  await pool.execute('SELECT 1');
  return true;
}

module.exports = { ping };

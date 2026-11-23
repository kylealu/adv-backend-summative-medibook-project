/**
 * Append-only audit log (JSON Lines) using the async `fs/promises` API.
 *
 *  - The log directory is created on first use (mkdir -p), no *Sync calls.
 *  - audit() NEVER throws or rejects: a logging failure is reported to
 *    stderr but must not fail the user's request. Callers can therefore
 *    fire-and-forget it (`audit(...)` without await) so the HTTP response
 *    is not delayed by disk I/O.
 *  - Both the API and the worker append to the same file. Each line is
 *    written with a single appendFile call (O_APPEND), so concurrent
 *    writers do not interleave within a line.
 */
const fs = require('fs/promises');
const path = require('path');
const { auditLogPath } = require('../config/env');

const LOG_FILE = path.resolve(auditLogPath);
let dirReady = null; // memoised mkdir promise

function ensureDir() {
  if (!dirReady) {
    dirReady = fs.mkdir(path.dirname(LOG_FILE), { recursive: true }).catch((err) => {
      dirReady = null; // retry on the next call
      throw err;
    });
  }
  return dirReady;
}

async function audit(event, data = {}) {
  try {
    await ensureDir();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...data });
    await fs.appendFile(LOG_FILE, `${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[audit] failed to write "${event}" to ${LOG_FILE}: ${err.message}`);
  }
}

module.exports = { audit, LOG_FILE };

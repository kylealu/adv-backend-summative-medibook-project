/**
 * MediBook background worker — a separate process from the web server.
 *   npm run worker
 *
 * Consumes medibook:jobs with the reliable-queue pattern:
 *   BLMOVE jobs -> jobs:processing   (job is never only in memory)
 *   success  -> LREM from processing
 *   failure  -> retry (up to MAX_JOB_ATTEMPTS) or move to jobs:failed
 * On start-up anything left in jobs:processing by a crashed worker is put
 * back on the queue, and in-flight waitlist promotions are reconciled.
 *
 * Job types:
 *   SEND_CONFIRMATION  write the confirmation SMS + email to the audit log
 *   SLOT_FREED         promote the first eligible waitlisted patient
 * Plus a periodic sweep that fills free slots from waitlists and expires
 * old entries (safety net for lost SLOT_FREED jobs).
 */
const { createRedisClient } = require('./config/redis');
const { pool } = require('./config/db');
const queue = require('./services/queueService');
const waitlistService = require('./services/waitlistService');
const { audit } = require('./services/auditLogger');

const { KEYS, JOB_TYPES } = queue;
const MAX_JOB_ATTEMPTS = 5;
const BLOCK_TIMEOUT_SECONDS = 5;
const SWEEP_INTERVAL_MS = Number(process.env.WAITLIST_SWEEP_MS) || 60_000;

const blocking = createRedisClient('worker-blocking'); // BLMOVE blocks its connection
let running = true;
let sweeping = false;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (...args) => console.log(new Date().toISOString(), '[worker]', ...args);

async function handleJob(job) {
  switch (job.type) {
    case JOB_TYPES.SEND_CONFIRMATION: {
      const p = job.payload;
      const message = `Hello ${p.patientName}, your appointment ${p.reference} with ${p.doctorName} `
        + `is confirmed for ${p.date} at ${p.time} in room ${p.room}.`;
      // No real sending: the "delivery" is an entry in the audit log per channel.
      await audit('NOTIFICATION_SENT', { jobId: job.id, channel: 'SMS', to: p.phone, appointmentId: p.appointmentId, message });
      await audit('NOTIFICATION_SENT', { jobId: job.id, channel: 'EMAIL', to: p.email, appointmentId: p.appointmentId, message });
      log(`confirmation sent for appointment ${p.appointmentId}`);
      return;
    }
    case JOB_TYPES.SLOT_FREED: {
      const { doctorId, date, time } = job.payload;
      const result = await waitlistService.promoteForSlot(doctorId, date, time);
      log(`slot freed doctor=${doctorId} ${date} ${time}:`, JSON.stringify(result));
      return;
    }
    default:
      throw new Error(`Unknown job type "${job.type}"`);
  }
}

async function processOne() {
  const raw = await blocking.blmove(KEYS.jobs, KEYS.jobsProcessing, 'LEFT', 'RIGHT', BLOCK_TIMEOUT_SECONDS);
  if (!raw) return; // timed out, loop again (lets us notice shutdown)

  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    await queue.redis().multi().lrem(KEYS.jobsProcessing, 1, raw).rpush(KEYS.jobsFailed, raw).exec();
    log('dropped malformed job to dead-letter list');
    return;
  }

  try {
    await handleJob(job);
    await queue.redis().lrem(KEYS.jobsProcessing, 1, raw);
  } catch (err) {
    const attempts = (job.attempts || 0) + 1;
    const retried = JSON.stringify({ ...job, attempts, lastError: err.message });
    const target = attempts >= MAX_JOB_ATTEMPTS ? KEYS.jobsFailed : KEYS.jobs;
    await queue.redis().multi().lrem(KEYS.jobsProcessing, 1, raw).rpush(target, retried).exec();
    log(`job ${job.id} (${job.type}) failed attempt ${attempts}: ${err.message}`
      + (target === KEYS.jobsFailed ? ' -> moved to dead-letter list' : ' -> will retry'));
    await sleep(Math.min(1000 * attempts, 5000)); // simple back-off
  }
}

/** Put back jobs a previous worker took but never finished. */
async function recoverJobs() {
  let moved = 0;
  // LMOVE one by one keeps every job in exactly one list at all times.
  while (await queue.redis().lmove(KEYS.jobsProcessing, KEYS.jobs, 'LEFT', 'LEFT')) moved += 1;
  if (moved) log(`recovered ${moved} unfinished job(s)`);
}

async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const promoted = await waitlistService.sweep();
    if (promoted.length) log(`sweep promoted ${promoted.length} waitlisted patient(s)`);
  } catch (err) {
    log('sweep failed:', err.message);
  } finally {
    sweeping = false;
  }
}

async function main() {
  log('starting');
  await recoverJobs();
  const reconciled = await waitlistService.recoverInflight();
  if (reconciled) log(`reconciled ${reconciled} in-flight waitlist promotion(s)`);

  await runSweep();
  const timer = setInterval(runSweep, SWEEP_INTERVAL_MS);

  const shutdown = async (signal) => {
    if (!running) return;
    log(`${signal} received, shutting down`);
    running = false;
    clearInterval(timer);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log(`waiting for jobs on ${KEYS.jobs}`);
  while (running) {
    try {
      await processOne();
    } catch (err) {
      log('queue error:', err.message);
      await sleep(2000);
    }
  }

  blocking.disconnect();
  await queue.close();
  await pool.end();
  log('stopped');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});

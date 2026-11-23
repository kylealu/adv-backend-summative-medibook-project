/**
 * Redis data structures used by MediBook (all keys prefixed "medibook:").
 *
 * Job queue (reliable-queue pattern):
 *   medibook:jobs              LIST  pending jobs (RPUSH to add, worker BLMOVEs from the left)
 *   medibook:jobs:processing   LIST  jobs a worker has taken but not finished
 *   medibook:jobs:failed       LIST  jobs that failed MAX_JOB_ATTEMPTS times (dead letter)
 *
 * Waitlist (one FIFO list per doctor per day):
 *   medibook:waitlist:{doctorId}:{date}          LIST  JSON entries, oldest first
 *   medibook:waitlist:members:{doctorId}:{date}  SET   patient ids on that list (no duplicates)
 *   medibook:waitlist:index                      SET   "{doctorId}:{date}" of every non-empty list
 *   medibook:waitlist:inflight                   LIST  entries currently being promoted (crash recovery)
 *   medibook:waitlist:failed                     LIST  entries that could not be promoted, with reason
 *
 * A waitlist entry is only removed from its list AFTER its appointment has
 * been committed in MySQL, so a patient can never vanish from both.
 */
const crypto = require('crypto');
const { createRedisClient } = require('../config/redis');

const KEYS = {
  jobs: 'medibook:jobs',
  jobsProcessing: 'medibook:jobs:processing',
  jobsFailed: 'medibook:jobs:failed',
  waitlist: (doctorId, date) => `medibook:waitlist:${doctorId}:${date}`,
  members: (doctorId, date) => `medibook:waitlist:members:${doctorId}:${date}`,
  waitlistIndex: 'medibook:waitlist:index',
  inflight: 'medibook:waitlist:inflight',
  waitlistFailed: 'medibook:waitlist:failed',
  lock: (name) => `medibook:lock:${name}`,
};

const JOB_TYPES = {
  SEND_CONFIRMATION: 'SEND_CONFIRMATION',
  SLOT_FREED: 'SLOT_FREED',
};

let client = null;
function redis() {
  if (!client) client = createRedisClient('api');
  return client;
}

/* ----------------------------- jobs ---------------------------------- */

async function enqueueJob(type, payload) {
  const job = { id: crypto.randomUUID(), type, payload, attempts: 0, enqueuedAt: new Date().toISOString() };
  await redis().rpush(KEYS.jobs, JSON.stringify(job));
  return job;
}

/* --------------------------- waitlist -------------------------------- */

/**
 * Add a patient to the end of a doctor-day waitlist.
 * Returns { entry, position } or { duplicate: true } if already waiting.
 */
async function joinWaitlist({ patientId, doctorId, date, preferredTime = null }) {
  const r = redis();
  const added = await r.sadd(KEYS.members(doctorId, date), String(patientId));
  if (added === 0) return { duplicate: true };

  const entry = {
    id: crypto.randomUUID(),
    patientId,
    doctorId,
    date,
    preferredTime, // "HH:MM:00" or null = any free slot that day
    joinedAt: new Date().toISOString(),
  };
  const [[, length]] = await r
    .multi()
    .rpush(KEYS.waitlist(doctorId, date), JSON.stringify(entry))
    .sadd(KEYS.waitlistIndex, `${doctorId}:${date}`)
    .exec();
  return { entry, position: length };
}

/** Raw entries (strings) of one waitlist, oldest first. */
async function getWaitlistRaw(doctorId, date) {
  return redis().lrange(KEYS.waitlist(doctorId, date), 0, -1);
}

async function getWaitlist(doctorId, date) {
  const raw = await getWaitlistRaw(doctorId, date);
  return raw.map((item, index) => ({ position: index + 1, ...JSON.parse(item) }));
}

/** Remove one exact raw entry from its list and the member set. */
async function removeWaitlistEntry(raw) {
  const entry = JSON.parse(raw);
  const r = redis();
  const [[, removed]] = await r
    .multi()
    .lrem(KEYS.waitlist(entry.doctorId, entry.date), 1, raw)
    .srem(KEYS.members(entry.doctorId, entry.date), String(entry.patientId))
    .exec();
  await cleanupIndex(entry.doctorId, entry.date);
  return removed > 0;
}

/** Patient leaves a waitlist voluntarily. */
async function leaveWaitlist(doctorId, date, patientId) {
  const raw = await getWaitlistRaw(doctorId, date);
  const match = raw.find((item) => JSON.parse(item).patientId === patientId);
  if (!match) return false;
  return removeWaitlistEntry(match);
}

async function cleanupIndex(doctorId, date) {
  const r = redis();
  const length = await r.llen(KEYS.waitlist(doctorId, date));
  if (length === 0) {
    await r.multi()
      .srem(KEYS.waitlistIndex, `${doctorId}:${date}`)
      .del(KEYS.members(doctorId, date))
      .exec();
  }
}

async function listWaitlistKeys() {
  const members = await redis().smembers(KEYS.waitlistIndex);
  return members.map((member) => {
    const [doctorId, date] = member.split(':');
    return { doctorId: Number(doctorId), date };
  });
}

/** Mark / unmark an entry as being promoted, so a crashed worker can recover it. */
async function markInflight(raw) {
  await redis().rpush(KEYS.inflight, raw);
}
async function clearInflight(raw) {
  await redis().lrem(KEYS.inflight, 1, raw);
}
async function getInflight() {
  return redis().lrange(KEYS.inflight, 0, -1);
}

/** Move an entry to the dead-letter list (kept for staff follow-up, never silently dropped). */
async function failWaitlistEntry(raw, reason) {
  const entry = JSON.parse(raw);
  await redis().rpush(
    KEYS.waitlistFailed,
    JSON.stringify({ ...entry, failedAt: new Date().toISOString(), reason }),
  );
  await removeWaitlistEntry(raw);
}

async function getFailedWaitlistEntries() {
  const raw = await redis().lrange(KEYS.waitlistFailed, 0, -1);
  return raw.map((item) => JSON.parse(item));
}

/** Simple distributed lock (SET NX PX) so two workers never promote the same doctor-day at once. */
async function withLock(name, ttlMs, fn) {
  const token = crypto.randomUUID();
  const ok = await redis().set(KEYS.lock(name), token, 'PX', ttlMs, 'NX');
  if (!ok) return { locked: true };
  try {
    return { result: await fn() };
  } finally {
    // Only release the lock if we still own it.
    await redis().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      KEYS.lock(name),
      token,
    );
  }
}

async function ping() {
  return redis().ping();
}

async function close() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}

module.exports = {
  KEYS,
  JOB_TYPES,
  redis,
  enqueueJob,
  joinWaitlist,
  getWaitlist,
  getWaitlistRaw,
  removeWaitlistEntry,
  leaveWaitlist,
  listWaitlistKeys,
  markInflight,
  clearInflight,
  getInflight,
  failWaitlistEntry,
  getFailedWaitlistEntries,
  withLock,
  ping,
  close,
};

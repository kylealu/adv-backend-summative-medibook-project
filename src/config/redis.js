const Redis = require('ioredis');
const { redisUrl } = require('./env');

/** Create a Redis client. Blocking commands (BLMOVE) need their own client. */
function createRedisClient(name = 'medibook') {
  const client = new Redis(redisUrl, { connectionName: name, maxRetriesPerRequest: 3 });
  client.on('error', (err) => console.error(`[redis:${name}]`, err.message));
  return client;
}

module.exports = { createRedisClient };

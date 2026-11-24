const app = require('./app');
const { port } = require('./config/env');
const { pool } = require('./config/db');
const healthModel = require('./models/healthModel');
const queue = require('./services/queueService');

async function start() {
  try {
    await healthModel.ping();
    console.log('[server] connected to MySQL');
  } catch (err) {
    console.error(`[server] cannot reach MySQL: ${err.message}. Check DB_* in .env and that schema.sql was run.`);
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`[server] MediBook API listening on http://localhost:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, closing`);
    server.close(async () => {
      await queue.close();
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();

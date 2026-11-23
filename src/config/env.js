require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'medibook',
  },
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  auditLogPath: process.env.AUDIT_LOG_PATH || 'logs/audit.log',
};

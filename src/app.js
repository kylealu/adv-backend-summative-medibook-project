const express = require('express');
const { api, pages } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const h = require('./middleware/asyncHandler');
const healthModel = require('./models/healthModel');
const queue = require('./services/queueService');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' })); // feedback form

app.get('/', (req, res) => {
  res.json({
    name: 'MediBook API',
    endpoints: ['/api/patients', '/api/doctors', '/api/appointments', '/api/reports/doctors',
      '/api/reports/busy-days', '/api/waitlist/failed', '/feedback', '/health'],
  });
});

// Liveness/readiness: reports MySQL and Redis status separately.
app.get('/health', h(async (req, res) => {
  const check = async (fn) => {
    try { await fn(); return 'up'; } catch { return 'down'; }
  };
  const [mysql, redis] = await Promise.all([
    check(() => healthModel.ping()),
    check(() => queue.ping()),
  ]);
  const ok = mysql === 'up' && redis === 'up';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', mysql, redis });
}));

app.use('/api', api);
app.use(pages);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

const { loadLocale, formatToday } = require('../utils/i18n');
const { renderForm, renderThankYou } = require('../views/feedbackPage');

const QUESTION_COUNT = 5;

async function context(req) {
  const { lang, strings } = await loadLocale(req.query.lang);
  return { lang, strings, today: formatToday(strings.locale) };
}

// GET /feedback[?lang=fr]
async function show(req, res) {
  res.type('html').send(renderForm(await context(req)));
}

// POST /feedback[?lang=fr]  (form submission: q1..q5)
async function submit(req, res) {
  const ctx = await context(req);
  const body = req.body || {};
  const answers = Array.from({ length: QUESTION_COUNT }, (_, i) => {
    const value = body[`q${i + 1}`];
    return typeof value === 'string' ? value.trim() : '';
  });
  if (answers.some((answer) => answer === '')) {
    res.status(400).type('html').send(renderForm({ ...ctx, answers, error: ctx.strings.missingAnswers }));
    return;
  }
  res.type('html').send(renderThankYou(ctx));
}

module.exports = { show, submit };

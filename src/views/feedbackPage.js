/** Server-rendered HTML for GET/POST /feedback. All dynamic text is HTML-escaped. */
const { SUPPORTED } = require('../utils/i18n');

const LANGUAGE_NAMES = { en: 'English', fr: 'Français' };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  :root { color-scheme: light dark; --accent: #1f6feb; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 760px;
         margin: 0 auto; padding: 24px 16px 48px; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  h1 { font-size: 1.6rem; margin: 0 0 8px; }
  .meta { color: GrayText; font-size: .95rem; }
  nav a { margin-left: 8px; }
  nav a[aria-current="true"] { font-weight: 700; text-decoration: none; }
  ol { padding-left: 1.2rem; }
  li { margin: 20px 0; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 110px; padding: 10px; font: inherit;
             border-radius: 8px; border: 1px solid GrayText; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 8px;
           padding: 10px 18px; font: inherit; cursor: pointer; }
  .error { color: #b42318; font-weight: 600; }
`;

function layout({ lang, strings, today, body }) {
  const nav = SUPPORTED.map((code) => (
    `<a href="/feedback?lang=${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ''}>`
    + `${escapeHtml(LANGUAGE_NAMES[code] || code)}</a>`
  )).join('');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(strings.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <p class="meta">${escapeHtml(strings.dateLabel)}: <time>${escapeHtml(today)}</time></p>
    <nav aria-label="${escapeHtml(strings.languageLabel)}">${escapeHtml(strings.languageLabel)}: ${nav}</nav>
  </header>
  ${body}
</body>
</html>`;
}

function renderForm({ lang, strings, today, answers = [], error = null }) {
  const questions = strings.questions.map((question, i) => `
      <li>
        <label for="q${i + 1}">${escapeHtml(question)}</label>
        <textarea id="q${i + 1}" name="q${i + 1}" required
          placeholder="${escapeHtml(strings.answerPlaceholder)}">${escapeHtml(answers[i] || '')}</textarea>
      </li>`).join('');

  const body = `
  <main>
    <h1>${escapeHtml(strings.title)}</h1>
    <p>${escapeHtml(strings.instructions)}</p>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/feedback?lang=${escapeHtml(lang)}">
      <ol>${questions}
      </ol>
      <button type="submit">${escapeHtml(strings.submit)}</button>
    </form>
  </main>`;
  return layout({ lang, strings, today, body });
}

function renderThankYou({ lang, strings, today }) {
  const body = `
  <main>
    <h1>${escapeHtml(strings.thankYouTitle)}</h1>
    <p>${escapeHtml(strings.thankYouMessage)}</p>
    <p><a href="/feedback?lang=${escapeHtml(lang)}">${escapeHtml(strings.back)}</a></p>
  </main>`;
  return layout({ lang, strings, today, body });
}

module.exports = { renderForm, renderThankYou, escapeHtml };

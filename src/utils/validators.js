/**
 * Request-body validation (pure functions). Each validator returns
 *   { errors: [{ field, message }], value: { ...cleaned fields } }
 * With { partial: true } (PATCH) only the fields present are validated,
 * but at least one updatable field must be supplied.
 */
const { parseDate } = require('./slot');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,18}$/;

function str(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function makeValidator(rules) {
  return function validate(body, { partial = false } = {}) {
    const errors = [];
    const value = {};

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { errors: [{ field: 'body', message: 'Request body must be a JSON object' }], value };
    }

    const unknown = Object.keys(body).filter((key) => !(key in rules));
    for (const key of unknown) errors.push({ field: key, message: `Unknown field "${key}"` });

    for (const [field, rule] of Object.entries(rules)) {
      const present = body[field] !== undefined;
      if (!present) {
        if (!partial && rule.required) errors.push({ field, message: `${field} is required` });
        continue;
      }
      if (body[field] === null && !rule.required) {
        value[field] = null;
        continue;
      }
      const message = rule.check(body[field]);
      if (message) errors.push({ field, message });
      else value[field] = rule.clean ? rule.clean(body[field]) : body[field];
    }

    if (partial && errors.length === 0 && Object.keys(value).length === 0) {
      errors.push({ field: 'body', message: 'Provide at least one field to update' });
    }
    return { errors, value };
  };
}

const text = (label, max) => ({
  required: true,
  clean: str,
  check: (v) => {
    if (typeof v !== 'string' || v.trim() === '') return `${label} must be a non-empty string`;
    if (v.trim().length > max) return `${label} must be at most ${max} characters`;
    return null;
  },
});

const email = {
  required: true,
  clean: (v) => v.trim().toLowerCase(),
  check: (v) => (typeof v === 'string' && v.trim().length <= 255 && EMAIL_RE.test(v.trim())
    ? null
    : 'email must be a valid email address'),
};

const validatePatient = makeValidator({
  full_name: text('full_name', 100),
  email,
  phone: {
    required: true,
    clean: str,
    check: (v) => (typeof v === 'string' && PHONE_RE.test(v.trim())
      ? null
      : 'phone must be 6–19 characters of digits, spaces, dashes or brackets (optional leading +)'),
  },
  date_of_birth: {
    required: false,
    clean: str,
    check: (v) => {
      const d = parseDate(v);
      if (!d) return 'date_of_birth must be a valid date in YYYY-MM-DD format';
      if (new Date(d.y, d.m - 1, d.d) > new Date()) return 'date_of_birth cannot be in the future';
      return null;
    },
  },
});

const validateDoctor = makeValidator({
  full_name: text('full_name', 100),
  email,
  specialty: text('specialty', 100),
  consultation_fee: {
    required: true,
    clean: (v) => Number(v),
    check: (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'consultation_fee must be a number';
      if (v < 0) return 'consultation_fee cannot be negative';
      if (v > 99999999.99) return 'consultation_fee is too large';
      if (Math.round(v * 100) !== v * 100) return 'consultation_fee can have at most 2 decimal places';
      return null;
    },
  },
  room: text('room', 10),
});

/** Positive integer id from a URL param or body field; null when invalid. */
function parseId(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isInteger(n) && n > 0 && n <= 4294967295 ? n : null;
}

module.exports = { validatePatient, validateDoctor, parseId };

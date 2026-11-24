const { validatePatient, validateDoctor, parseId } = require('../src/utils/validators');
const { resolveLang } = require('../src/utils/i18n');

describe('validatePatient', () => {
  const valid = { full_name: 'Ama Mensah', email: 'AMA@mail.com ', phone: '0244-111-222' };

  test('accepts a valid patient and normalises the email', () => {
    const { errors, value } = validatePatient(valid);
    expect(errors).toEqual([]);
    expect(value.email).toBe('ama@mail.com');
  });

  test('reports every missing required field on create', () => {
    const { errors } = validatePatient({});
    expect(errors.map((e) => e.field).sort()).toEqual(['email', 'full_name', 'phone']);
  });

  test('rejects unknown fields and a future date of birth', () => {
    const { errors } = validatePatient({ ...valid, role: 'admin', date_of_birth: '2999-01-01' });
    expect(errors.map((e) => e.field).sort()).toEqual(['date_of_birth', 'role']);
  });

  test('PATCH (partial) needs at least one field', () => {
    expect(validatePatient({}, { partial: true }).errors[0].field).toBe('body');
    expect(validatePatient({ phone: '0555 333 444' }, { partial: true }).errors).toEqual([]);
  });
});

describe('validateDoctor', () => {
  const valid = { full_name: 'Dr. Boateng', email: 'b@clinic.com', specialty: 'Dermatology', consultation_fee: 150, room: 'R-12' };

  test('accepts a valid doctor', () => {
    expect(validateDoctor(valid).errors).toEqual([]);
  });

  test.each([-1, '150', 12.345, NaN])('rejects consultation_fee %p', (fee) => {
    expect(validateDoctor({ ...valid, consultation_fee: fee }).errors[0].field).toBe('consultation_fee');
  });
});

describe('parseId', () => {
  test.each([['5', 5], [7, 7]])('%p -> %p', (input, expected) => expect(parseId(input)).toBe(expected));
  test.each(['0', '-1', '1.5', 'abc', '', undefined, '1 OR 1=1'])('%p -> null', (input) => {
    expect(parseId(input)).toBeNull();
  });
});

describe('resolveLang (feedback page i18n)', () => {
  test('supported languages are used, case-insensitively', () => {
    expect(resolveLang('fr')).toBe('fr');
    expect(resolveLang('FR')).toBe('fr');
  });
  test.each(['de', '', undefined, ['fr', 'en'], '../../package'])('unsupported %p falls back to en', (input) => {
    expect(resolveLang(input)).toBe('en');
  });
});

const { validateSlot, daySlots, parseDate, parseTime } = require('../src/utils/slot');

// Fixed "now" so the tests never depend on the real clock: 1 Aug 2026 12:00 local.
const NOW = new Date(2026, 7, 1, 12, 0, 0);
const check = (date, time) => validateSlot(date, time, NOW);

describe('validateSlot — valid slots', () => {
  test('first slot of the day (09:00) is accepted and normalised', () => {
    expect(check('2026-08-10', '09:00')).toMatchObject({ ok: true, date: '2026-08-10', time: '09:00:00' });
  });

  test('last slot of the day (16:30) is accepted', () => {
    expect(check('2026-08-10', '16:30').ok).toBe(true);
  });

  test('HH:MM:00 format is accepted too', () => {
    expect(check('2026-08-10', '10:30:00').ok).toBe(true);
  });
});

describe('validateSlot — working hours and slot boundaries', () => {
  test('17:00 exactly is rejected: a 30-minute appointment would end after closing', () => {
    expect(check('2026-08-10', '17:00')).toMatchObject({ ok: false, code: 'OUTSIDE_WORKING_HOURS' });
  });

  test('08:30 (before opening) is rejected', () => {
    expect(check('2026-08-10', '08:30')).toMatchObject({ ok: false, code: 'OUTSIDE_WORKING_HOURS' });
  });

  test('09:15 is not on a 30-minute boundary', () => {
    expect(check('2026-08-10', '09:15')).toMatchObject({ ok: false, code: 'NOT_ON_SLOT_BOUNDARY' });
  });

  test('seconds other than :00 are not on a boundary', () => {
    expect(check('2026-08-10', '09:30:15')).toMatchObject({ ok: false, code: 'NOT_ON_SLOT_BOUNDARY' });
  });
});

describe('validateSlot — past/future', () => {
  test('a slot earlier today is in the past', () => {
    expect(check('2026-08-01', '11:30')).toMatchObject({ ok: false, code: 'IN_PAST' });
  });

  test('the slot starting exactly now is not "in the future"', () => {
    expect(check('2026-08-01', '12:00')).toMatchObject({ ok: false, code: 'IN_PAST' });
  });

  test('the next slot later today is fine', () => {
    expect(check('2026-08-01', '12:30').ok).toBe(true);
  });
});

describe('validateSlot — malformed input', () => {
  test.each([
    ['2026-02-30', '10:00'], // not a real date
    ['2026-13-01', '10:00'], // month 13
    ['10/08/2026', '10:00'], // wrong format
    ['', '10:00'],
    [null, '10:00'],
  ])('date %p is rejected as INVALID_FORMAT', (date, time) => {
    expect(check(date, time)).toMatchObject({ ok: false, code: 'INVALID_FORMAT' });
  });

  test.each(['25:00', '9:00', '10:60', 'noon', 1000, undefined])('time %p is rejected as INVALID_FORMAT', (time) => {
    expect(check('2026-08-10', time)).toMatchObject({ ok: false, code: 'INVALID_FORMAT' });
  });
});

describe('helpers', () => {
  test('a working day has 16 possible 30-minute slots, 09:00 to 16:30', () => {
    const slots = daySlots();
    expect(slots).toHaveLength(16);
    expect(slots[0]).toBe('09:00:00');
    expect(slots[slots.length - 1]).toBe('16:30:00');
  });

  test('parseDate handles leap years', () => {
    expect(parseDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseDate('2027-02-29')).toBeNull();
  });

  test('parseTime rejects out-of-range values', () => {
    expect(parseTime('23:59')).toEqual({ hh: 23, mm: 59, ss: 0 });
    expect(parseTime('24:00')).toBeNull();
  });
});

const { calculateRefund, refundPercentForNotice } = require('../src/utils/refund');

const HOUR = 60 * 60 * 1000;
const appointment = new Date(2026, 7, 10, 9, 0, 0); // 10 Aug 2026 09:00 local
const hoursBefore = (h) => new Date(appointment.getTime() - h * HOUR);

describe('refund tiers', () => {
  test('more than 48 hours notice -> 100%', () => {
    expect(calculateRefund(150, appointment, hoursBefore(72))).toMatchObject({ percent: 100, amount: 150 });
  });

  test('between 24 and 48 hours notice -> 50%', () => {
    expect(calculateRefund(150, appointment, hoursBefore(36))).toMatchObject({ percent: 50, amount: 75 });
  });

  test('less than 24 hours notice -> 0%', () => {
    expect(calculateRefund(150, appointment, hoursBefore(5))).toMatchObject({ percent: 0, amount: 0 });
  });
});

describe('refund boundaries (documented policy: both 24h and 48h fall in the 50% tier)', () => {
  test('exactly 48 hours is NOT "more than 48 hours" -> 50%', () => {
    const result = calculateRefund(150, appointment, hoursBefore(48));
    expect(result.hoursNotice).toBe(48);
    expect(result.percent).toBe(50);
    expect(result.amount).toBe(75);
  });

  test('one second over 48 hours -> 100%', () => {
    const cancelledAt = new Date(appointment.getTime() - 48 * HOUR - 1000);
    expect(calculateRefund(150, appointment, cancelledAt).percent).toBe(100);
  });

  test('exactly 24 hours is inside "24–48 hours" -> 50%', () => {
    const result = calculateRefund(150, appointment, hoursBefore(24));
    expect(result.hoursNotice).toBe(24);
    expect(result.percent).toBe(50);
  });

  test('one second under 24 hours -> 0%', () => {
    const cancelledAt = new Date(appointment.getTime() - 24 * HOUR + 1000);
    expect(calculateRefund(150, appointment, cancelledAt).percent).toBe(0);
  });
});

describe('refund amounts and input handling', () => {
  test('uses the amount actually paid, not the doctor fee (AP-002 paid 120.00)', () => {
    expect(calculateRefund(120, appointment, hoursBefore(30)).amount).toBe(60);
  });

  test('rounds to whole cents without floating-point drift', () => {
    expect(calculateRefund(100.01, appointment, hoursBefore(30)).amount).toBe(50.01);
    expect(calculateRefund(0.1 + 0.2, appointment, hoursBefore(100)).amount).toBe(0.3);
  });

  test('refundPercentForNotice works directly on hours', () => {
    expect(refundPercentForNotice(48.01)).toBe(100);
    expect(refundPercentForNotice(48)).toBe(50);
    expect(refundPercentForNotice(24)).toBe(50);
    expect(refundPercentForNotice(23.99)).toBe(0);
    expect(refundPercentForNotice(-1)).toBe(0);
  });

  test('rejects invalid input', () => {
    expect(() => calculateRefund(-5, appointment)).toThrow(TypeError);
    expect(() => calculateRefund('150', appointment)).toThrow(TypeError);
    expect(() => calculateRefund(150, new Date('not a date'))).toThrow(TypeError);
    expect(() => refundPercentForNotice(NaN)).toThrow(TypeError);
  });
});

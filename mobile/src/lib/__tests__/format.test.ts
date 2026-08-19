import { formatNumber, formatPkr, pktToday, pktDaysAgo, pktDayStartIso } from '../format';

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(15000)).toBe('15,000');
    expect(formatNumber(9)).toBe('9');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('rounds rather than showing a fractional coin', () => {
    // Coins are integers. A "1,000.4 coins" balance is a bug made visible.
    expect(formatNumber(1000.4)).toBe('1,000');
    expect(formatNumber(1000.6)).toBe('1,001');
  });
});

describe('formatPkr', () => {
  it('is prefixed and grouped', () => {
    expect(formatPkr(2500)).toBe('PKR 2,500');
  });
});

/**
 * The business day is Asia/Karachi (UTC+5, no daylight saving). Casting to a
 * local date anywhere would roll the day over at 5am Pakistani time and break
 * every streak in the country.
 */
describe('the PKT business day', () => {
  it('is a YYYY-MM-DD string', () => {
    expect(pktToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('walks backwards a day at a time', () => {
    const today = new Date(`${pktToday()}T00:00:00Z`).getTime();
    const yesterday = new Date(`${pktDaysAgo(1)}T00:00:00Z`).getTime();
    expect(today - yesterday).toBe(86_400_000);
  });

  it('puts 22:00 UTC into the NEXT Karachi day', () => {
    // 22:00 UTC is 03:00 the following morning in Karachi. Getting this wrong is
    // how a user's evening walk lands on yesterday's total.
    const utcEvening = new Date('2026-08-19T22:00:00Z');
    const karachiDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(utcEvening);
    expect(karachiDay).toBe('2026-08-20');
  });
});

/**
 * The live counter asks the health store for "today", and today has to mean the
 * Karachi day. Get this wrong and the number shows yesterday's steps for the
 * first five hours of every morning — the exact window when someone checks it
 * on waking.
 */
describe('pktDayStartIso', () => {
  it('is 19:00 UTC the previous day', () => {
    // 10:00 UTC on the 19th is 15:00 PKT the same day.
    expect(pktDayStartIso(new Date('2026-08-19T10:00:00Z'))).toBe('2026-08-18T19:00:00.000Z');
  });

  it('rolls over at midnight Karachi, not midnight UTC', () => {
    // 18:59 UTC is 23:59 PKT — still the 19th in Karachi.
    expect(pktDayStartIso(new Date('2026-08-19T18:59:00Z'))).toBe('2026-08-18T19:00:00.000Z');
    // 19:00 UTC is 00:00 PKT on the 20th — a new day has begun.
    expect(pktDayStartIso(new Date('2026-08-19T19:00:00Z'))).toBe('2026-08-19T19:00:00.000Z');
  });

  it('agrees with pktToday across the boundary', () => {
    const justAfterMidnightPkt = new Date('2026-08-19T19:30:00Z');
    const start = pktDayStartIso(justAfterMidnightPkt);
    // Half an hour into the Karachi day, the day began half an hour ago.
    expect(justAfterMidnightPkt.getTime() - new Date(start).getTime()).toBe(30 * 60 * 1000);
  });
});

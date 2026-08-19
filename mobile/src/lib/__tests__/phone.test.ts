import { normalisePhone, displayPhone } from '../phone';

/**
 * People here write the same number half a dozen ways. Every one of these is
 * 0300 1234567, and rejecting four of the six is a signup funnel that leaks for
 * no reason.
 */
describe('normalisePhone', () => {
  const expected = '+923001234567';

  it.each([
    ['03001234567', 'the way it is written on a business card'],
    ['0300 1234567', 'with the space people actually type'],
    ['0300-1234567', 'with a dash'],
    ['+92 300 1234567', 'international, spaced'],
    ['+923001234567', 'international, bare'],
    ['923001234567', 'country code without the plus'],
    ['3001234567', 'national without the trunk zero'],
    ['(0300) 123 4567', 'with brackets, because someone will'],
  ])('accepts %s — %s', (input) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['0300123456', 'one digit short'],
    ['030012345678', 'one digit long'],
    ['02001234567', 'a landline, not a mobile'],
    ['+913001234567', 'an Indian number'],
    ['', 'empty'],
    ['not a number', 'not a number at all'],
  ])('rejects %s — %s', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('rejects a number that is only right after the country code is stripped twice', () => {
    // 9292... must not collapse to a valid national number by stripping "92" twice.
    expect(normalisePhone('92923001234567')).toBeNull();
  });
});

describe('displayPhone', () => {
  it('renders the way the number is read aloud', () => {
    expect(displayPhone('+923001234567')).toBe('0300 1234567');
  });

  it('leaves anything it does not recognise alone', () => {
    expect(displayPhone('+441234567890')).toBe('+441234567890');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePhone, formatPhoneLocal } from './phone.ts';

describe('Pakistani mobile numbers', () => {
  test('accepts every spelling people actually type', () => {
    for (const input of [
      '03001234567', '0300 1234567', '0300-1234567',
      '+923001234567', '+92 300 1234567', '92 300 1234567',
      '3001234567', '(0300) 123 4567',
    ]) {
      assert.equal(normalisePhone(input), '+923001234567', `failed on "${input}"`);
    }
  });

  test('covers the whole 3XX mobile range', () => {
    for (const prefix of ['300', '312', '321', '333', '345', '349']) {
      assert.equal(normalisePhone(`0${prefix}1234567`), `+92${prefix}1234567`);
    }
  });

  test('rejects what is not a Pakistani mobile', () => {
    assert.equal(normalisePhone('042 35712345'), null, 'a Lahore landline');
    assert.equal(normalisePhone('0300123456'), null, 'one digit short');
    assert.equal(normalisePhone('030012345678'), null, 'one digit long');
    assert.equal(normalisePhone('+447700900123'), null, 'a UK number');
    assert.equal(normalisePhone(''), null);
  });

  test('shows a number back the way it was typed', () => {
    assert.equal(formatPhoneLocal('+923001234567'), '0300 1234567');
  });
});

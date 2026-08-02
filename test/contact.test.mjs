import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContact } from '../src/contact.js';

const ok = { first_name: 'Ada', email: 'ada@example.com', message: 'I knew her.' };

test('a complete message passes', () => {
  assert.equal(validateContact(ok), null);
  assert.equal(validateContact({ ...ok, last_name: '', phone: '' }), null);
});

test('first name is required, last name and phone are not', () => {
  assert.match(validateContact({ ...ok, first_name: '' }), /first name/i);
  assert.match(validateContact({ ...ok, first_name: '   ' }), /first name/i);
  assert.equal(validateContact({ ...ok, last_name: undefined, phone: undefined }), null);
});

test('email must look like an address', () => {
  for (const email of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com']) {
    assert.match(validateContact({ ...ok, email }), /email/i, `should reject ${JSON.stringify(email)}`);
  }
  assert.equal(validateContact({ ...ok, email: 'ada.b+tip@sub.example.co.uk' }), null);
});

test('message is required', () => {
  assert.match(validateContact({ ...ok, message: '' }), /message/i);
  assert.match(validateContact({ ...ok, message: '\n  ' }), /message/i);
});

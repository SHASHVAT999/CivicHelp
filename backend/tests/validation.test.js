// Unit tests for the pure validation helpers. Run: npm test   (inside backend/)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRegistration, validateComplaint, parseId, toPublicComplaint, PUBLIC_FIELDS, CATEGORIES,
} = require('../utils/validation');

test('registration: accepts a valid citizen', () => {
  assert.equal(validateRegistration({ name: 'Asha', email: 'asha@example.com', password: 'secret1' }), null);
});

test('registration: rejects missing fields, bad email, short and over-long passwords', () => {
  assert.match(validateRegistration({ name: '', email: 'a@b.co', password: 'secret1' }), /required/);
  assert.match(validateRegistration({ name: 'A', email: 'not-an-email', password: 'secret1' }), /valid email/);
  assert.match(validateRegistration({ name: 'A', email: 'a@b.co', password: '123' }), /at least 6/);
  assert.match(validateRegistration({ name: 'A', email: 'a@b.co', password: 'x'.repeat(73) }), /at most 72/);
  assert.match(validateRegistration({ name: 'x'.repeat(101), email: 'a@b.co', password: 'secret1' }), /Name/);
});

test('complaint: accepts valid input and converts coordinates to numbers', () => {
  const { error, value } = validateComplaint({
    category: 'Pothole', description: '  deep hole ', latitude: '12.97', longitude: '77.59', address: 'MG Road',
  });
  assert.equal(error, undefined);
  assert.deepEqual(value, { category: 'Pothole', description: 'deep hole', latitude: 12.97, longitude: 77.59, address: 'MG Road' });
});

test('complaint: every category offered by the frontend is accepted', () => {
  for (const category of CATEGORIES) {
    assert.ok(validateComplaint({ category, latitude: 1, longitude: 1 }).value, category);
  }
});

test('complaint: rejects missing or out-of-range coordinates and unknown categories', () => {
  assert.match(validateComplaint({ category: 'Pothole' }).error, /required/);
  assert.match(validateComplaint({ category: 'Pothole', latitude: 'abc', longitude: '1' }).error, /coordinates/);
  assert.match(validateComplaint({ category: 'Pothole', latitude: '95', longitude: '1' }).error, /coordinates/);
  assert.match(validateComplaint({ category: 'Pothole', latitude: '1', longitude: '-181' }).error, /coordinates/);
  assert.match(validateComplaint({ category: 'Volcano', latitude: '1', longitude: '1' }).error, /Unknown category/);
  // 0,0 is a real coordinate and must not be treated as "missing"
  assert.ok(validateComplaint({ category: 'Other', latitude: 0, longitude: 0 }).value);
});

test('complaint: rejects text longer than the database columns', () => {
  assert.match(validateComplaint({ category: 'Other', latitude: 1, longitude: 1, address: 'x'.repeat(256) }).error, /Address/);
});

test('parseId: only positive integers are ids', () => {
  assert.equal(parseId('42'), 42);
  for (const bad of ['0', '-1', '1.5', 'abc', '', undefined, '1; DROP TABLE users']) assert.equal(parseId(bad), null, String(bad));
});

test('toPublicComplaint: never leaks citizen or staff data', () => {
  const row = {
    id: 1, category: 'Pothole', description: 'd', latitude: 1, longitude: 2, address: 'a', image_url: '/uploads/x.png',
    status: 'open', resolved_at: null, created_at: 'now',
    citizen_id: 7, citizen_name: 'Asha', citizen_email: 'asha@example.com', assigned_to: 3, worker_name: 'Ravi', citizen_feedback: 'f',
  };
  const pub = toPublicComplaint(row);
  assert.deepEqual(Object.keys(pub), PUBLIC_FIELDS);
  for (const secret of ['citizen_id', 'citizen_name', 'citizen_email', 'assigned_to', 'worker_name', 'citizen_feedback']) {
    assert.equal(pub[secret], undefined, secret);
  }
});

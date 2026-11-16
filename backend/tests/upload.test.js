// Unit tests for the upload security checks (magic-byte detection) and e-mail escaping.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectImageSignature, validateFileSignature } = require('../middleware/upload');
const { escapeHtml } = require('../utils/email');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBP', 'binary');

test('detects PNG, JPEG and WebP by their first bytes', () => {
  assert.equal(detectImageSignature(PNG), 'image/png');
  assert.equal(detectImageSignature(JPEG), 'image/jpeg');
  assert.equal(detectImageSignature(WEBP), 'image/webp');
});

test('rejects text, HTML and too-short files pretending to be images', () => {
  assert.equal(detectImageSignature(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(detectImageSignature(Buffer.from('hello world!')), null);
  assert.equal(detectImageSignature(Buffer.from([0x89, 0x50])), null);
});

test('a file whose content does not match its declared type is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civichelp-test-'));
  const file = path.join(dir, 'photo.png');
  try {
    fs.writeFileSync(file, PNG);
    assert.equal(validateFileSignature(file, 'image/png'), true);
    assert.equal(validateFileSignature(file, 'image/jpeg'), false);
    fs.writeFileSync(file, 'not really an image');
    assert.equal(validateFileSignature(file, 'image/png'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('e-mail text is HTML-escaped', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
});

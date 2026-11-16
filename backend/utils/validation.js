// Pure validation and shaping helpers shared by the route handlers.
// They have no database or Express dependencies, so they are unit-tested directly
// (backend/tests/validation.test.js).

const CATEGORIES = ['Pothole', 'Broken Streetlight', 'Garbage Dump', 'Open Drain', 'Other'];

// Column limits from init.sql, so the API rejects input the database would truncate or refuse.
const LIMITS = { name: 100, email: 100, category: 50, address: 255, description: 2000, notes: 2000, feedback: 2000 };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());

// Returns an error message, or null when the registration input is valid.
function validateRegistration({ name, email, password }) {
  const n = clean(name);
  const e = clean(email);
  if (!n || !e || !password) return 'Name, email, and password are required.';
  if (n.length > LIMITS.name) return `Name must be at most ${LIMITS.name} characters.`;
  if (e.length > LIMITS.email || !EMAIL_PATTERN.test(e)) return 'Please provide a valid email address.';
  if (String(password).length < 6) return 'Password must be at least 6 characters.';
  if (String(password).length > 72) return 'Password must be at most 72 characters.'; // bcrypt input limit
  return null;
}

// Validates a new complaint. Returns { error } or { value } with cleaned, typed fields.
function validateComplaint({ category, description, latitude, longitude, address }) {
  const cat = clean(category);
  if (!cat || latitude === undefined || latitude === '' || longitude === undefined || longitude === '') {
    return { error: 'Category, latitude, and longitude are required.' };
  }
  if (!CATEGORIES.includes(cat)) {
    return { error: `Unknown category. Use one of: ${CATEGORIES.join(', ')}.` };
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'Invalid coordinates provided.' };
  }
  const desc = clean(description);
  const addr = clean(address);
  if (desc.length > LIMITS.description) return { error: `Description must be at most ${LIMITS.description} characters.` };
  if (addr.length > LIMITS.address) return { error: `Address must be at most ${LIMITS.address} characters.` };
  return { value: { category: cat, description: desc, latitude: lat, longitude: lng, address: addr } };
}

// A positive integer id from a URL parameter or body field, or null.
function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The only complaint fields that may be broadcast to everyone over Socket.IO or shown on the public map:
// no citizen identity, no staff names, no feedback.
const PUBLIC_FIELDS = ['id', 'category', 'description', 'latitude', 'longitude', 'address', 'image_url', 'status', 'resolved_at', 'created_at'];

function toPublicComplaint(row) {
  const out = {};
  for (const key of PUBLIC_FIELDS) out[key] = row[key] === undefined ? null : row[key];
  return out;
}

module.exports = {
  CATEGORIES,
  LIMITS,
  PUBLIC_FIELDS,
  clean,
  validateRegistration,
  validateComplaint,
  parseId,
  toPublicComplaint,
};

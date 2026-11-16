// CivicHelp integration test: the complete citizen -> officer -> worker -> citizen workflow,
// driven through the Nginx front door exactly like a browser would use it.
//
// It runs in the Jenkins "Integration Test" stage against a THROWAWAY stack started from the
// freshly built images (docker-compose.ci.yml, database in memory). Never point it at production:
// it creates users and complaints.
//
//   BASE=http://frontend node workflow.test.js
//
// No dependencies: Node's built-in fetch/FormData, and a tiny Socket.IO (Engine.IO v4) polling client.
const zlib = require('zlib');

const BASE = (process.env.BASE || 'http://localhost').replace(/\/$/, '');
const API = `${BASE}/api`;
const PASS = process.env.TEST_PASSWORD || 'CiTest123';
const OFFICER = process.env.OFFICER_EMAIL || 'ci-officer@test.local';
const WORKER = process.env.WORKER_EMAIL || 'ci-worker@test.local';

let passed = 0;
let failed = 0;
const check = (cond, name, detail) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); return; }
  failed++;
  console.log(`  FAIL  ${name}${detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300)}`);
};
const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------- helpers
// A real, valid PNG (solid colour) so the server's magic-byte check accepts it
function png(r, g, b, size = 16) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const o = y * (size * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const photo = (field, name, rgb) => { const fd = new FormData(); fd.append(field, new Blob([png(...rgb)], { type: 'image/png' }), name); return fd; };

async function call(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${API}${path}`, { method, headers, body });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data, headers: res.headers };
}
const login = async (email) => (await call('POST', '/auth/login', { json: { email, password: PASS } })).data || {};

// Minimal Socket.IO client over HTTP long-polling (what a browser falls back to).
// Proves the real-time path Browser -> Nginx /socket.io -> Express works.
function socketClient() {
  const events = [];
  let sid = null;
  let open = true;
  const url = () => `${BASE}/socket.io/?EIO=4&transport=polling${sid ? `&sid=${sid}` : ''}&t=${Date.now()}`;
  const send = (packet) => fetch(url(), { method: 'POST', body: packet, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
  let connected;
  const ready = new Promise((resolve) => { connected = resolve; });
  const handle = (packet) => {
    if (packet === '2') send('3');                       // ping -> pong
    else if (packet.startsWith('40')) connected(true);   // namespace connected
    else if (packet.startsWith('42')) { try { const [type, data] = JSON.parse(packet.slice(2)); events.push({ type, data }); } catch { /* ignore */ } }
  };
  (async () => {
    try {
      const first = await (await fetch(url())).text();    // "0{...sid...}" handshake
      sid = JSON.parse(first.slice(1)).sid;
      await send('40');                                    // join the default namespace
      while (open) {
        const text = await (await fetch(url())).text();
        text.split('\x1e').forEach(handle);
      }
    } catch (e) { if (open) { console.log(`  (socket error: ${e.message})`); connected(false); } }
  })();
  const waitFor = (pred, ms = 5000) => new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const hit = events.find(pred);
      if (hit || Date.now() - start > ms) { clearInterval(timer); resolve(hit); }
    }, 50);
  });
  return { ready: Promise.race([ready, new Promise((r) => setTimeout(() => r(false), 8000))]), waitFor, close: () => { open = false; } };
}

// ---------------------------------------------------------------- the test
(async () => {
  section('Infrastructure through Nginx');
  let r = await call('GET', '/health');
  check(r.status === 200 && r.data?.database === 'connected', 'API health reports the database as connected', r.data);
  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  check(home.status === 200 && html.includes('id="root"'), 'Nginx serves the React app');
  check(home.headers.get('x-content-type-options') === 'nosniff', 'Nginx sends security headers');
  const deep = await fetch(`${BASE}/dashboard`);
  check(deep.status === 200 && (await deep.text()).includes('id="root"'), 'client-side routes fall back to index.html');
  r = await call('GET', '/does-not-exist');
  check(r.status === 404 && r.data?.error, 'unknown API route returns JSON 404', r.status);
  r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  check(r.status === 400, 'malformed JSON returns 400 (not 500)', r.status);

  section('Accounts and authentication');
  const citizenEmail = `ci-citizen-${Date.now()}@test.local`;
  r = await call('POST', '/auth/register', { json: { name: 'CI Citizen', email: citizenEmail, password: PASS, role: 'officer' } });
  check(r.status === 201, 'citizen registers', r);
  r = await call('POST', '/auth/register', { json: { name: 'CI Citizen', email: citizenEmail, password: PASS } });
  check(r.status === 409, 'duplicate e-mail rejected (409)', r.status);
  r = await call('POST', '/auth/register', { json: { name: 'X', email: 'bad', password: PASS } });
  check(r.status === 400, 'invalid e-mail rejected (400)', r.status);
  r = await call('POST', '/auth/login', { json: { email: citizenEmail, password: 'wrong-password' } });
  check(r.status === 401, 'wrong password rejected (401)', r.status);

  const citizen = await login(citizenEmail);
  const officer = await login(OFFICER);
  const worker = await login(WORKER);
  check(citizen.user?.role === 'citizen', 'register ignores a requested role (no privilege escalation)', citizen.user);
  check(officer.user?.role === 'officer', 'ward officer logs in');
  check(worker.user?.role === 'worker', 'field worker logs in');
  r = await call('GET', '/complaints/my', { token: 'not-a-real-token' });
  check(r.status === 401, 'invalid JWT rejected (401)', r.status);

  section('Real-time updates (Socket.IO through Nginx)');
  const socket = socketClient();
  check(await socket.ready, 'Socket.IO connection established');

  section('Citizen reports an issue with a photo');
  let fd = photo('image', 'before.png', [200, 40, 40]);
  fd.append('category', 'Pothole');
  fd.append('description', 'CI test pothole');
  fd.append('address', 'CI Test Road');
  fd.append('latitude', '12.9716');
  fd.append('longitude', '77.5946');
  r = await call('POST', '/complaints', { token: citizen.token, form: fd });
  check(r.status === 201 && r.data?.image_url, 'complaint created with photo', r);
  check(r.data && r.data.citizen_email === undefined, 'response does not expose the citizen e-mail');
  const id = r.data?.id;
  const created = await socket.waitFor((e) => e.type === 'newComplaint' && e.data.id === id);
  check(!!created, 'newComplaint pushed to connected browsers');
  check(created && created.data.citizen_id === undefined && created.data.citizen_name === undefined, 'broadcast contains no personal data', created?.data);
  const img = await fetch(`${BASE}${r.data?.image_url}`);
  check(img.status === 200 && (img.headers.get('content-type') || '').includes('image/png'), 'uploaded photo is served through Nginx', img.status);

  fd = new FormData();
  fd.append('category', 'Pothole'); fd.append('latitude', '12.9'); fd.append('longitude', '77.5');
  fd.append('image', new Blob([Buffer.from('this is text, not a picture')], { type: 'image/png' }), 'fake.png');
  r = await call('POST', '/complaints', { token: citizen.token, form: fd });
  check(r.status === 400, 'fake image (wrong file signature) rejected', r.status);
  r = await call('POST', '/complaints', { token: citizen.token, json: { category: 'Pothole' } });
  check(r.status === 400, 'complaint without coordinates rejected', r.status);
  r = await call('POST', '/complaints', { token: citizen.token, json: { category: 'Pothole', latitude: 200, longitude: 10 } });
  check(r.status === 400, 'out-of-range coordinates rejected', r.status);
  r = await call('GET', '/complaints');
  check(r.status === 200 && r.data.some((c) => c.id === id) && r.data.every((c) => c.citizen_id === undefined), 'public map lists it without citizen ids');

  section('Permissions');
  r = await call('GET', '/complaints/officer', { token: citizen.token });
  check(r.status === 403, 'citizen cannot read officer data', r.status);
  r = await call('PATCH', `/complaints/${id}/assign`, { token: citizen.token, json: { worker_id: worker.user?.id } });
  check(r.status === 403, 'citizen cannot assign', r.status);
  r = await call('PATCH', `/complaints/${id}/status`, { token: citizen.token, json: { status: 'in_progress' } });
  check(r.status === 403, 'citizen cannot change status', r.status);
  r = await call('POST', `/complaints/${id}/resolve`, { token: worker.token, form: photo('resolution_image', 'after.png', [0, 200, 0]) });
  check(r.status === 403, 'worker cannot resolve a complaint not assigned to them', r.status);

  section('Ward officer assigns a field worker');
  r = await call('GET', '/complaints/workers', { token: officer.token });
  check(r.status === 200 && r.data.some((w) => w.id === worker.user?.id), 'officer sees the worker roster');
  r = await call('PATCH', `/complaints/${id}/assign`, { token: officer.token, json: { worker_id: citizen.user?.id } });
  check(r.status === 400, 'assigning to a non-worker rejected', r.status);
  r = await call('PATCH', `/complaints/${id}/assign`, { token: officer.token, json: { worker_id: worker.user?.id } });
  check(r.status === 200 && r.data?.status === 'in_progress' && r.data?.worker_name === worker.user?.name, 'complaint assigned -> in_progress', r);
  check(!!(await socket.waitFor((e) => e.type === 'statusUpdated' && e.data.id === id && e.data.status === 'in_progress')), 'assignment pushed in real time');

  section('Field worker resolves with photo proof');
  r = await call('GET', '/complaints/assigned', { token: worker.token });
  check(r.status === 200 && r.data.some((c) => c.id === id), 'worker sees the assignment');
  r = await call('PATCH', `/complaints/${id}/status`, { token: worker.token, json: { status: 'resolved' } });
  check(r.status === 400, 'resolving without proof via status endpoint rejected', r.status);
  r = await call('POST', `/complaints/${id}/resolve`, { token: worker.token, form: new FormData() });
  check(r.status === 400, 'resolving without a photo rejected', r.status);
  fd = photo('resolution_image', 'after.png', [0, 200, 0]);
  fd.append('resolution_notes', 'Filled and compacted');
  r = await call('POST', `/complaints/${id}/resolve`, { token: worker.token, form: fd });
  check(r.status === 200 && r.data?.status === 'resolved' && r.data?.citizen_confirmation_status === 'pending', 'resolved; citizen confirmation pending', r);
  check(!!(await socket.waitFor((e) => e.type === 'statusUpdated' && e.data.id === id && e.data.status === 'resolved')), 'resolution pushed in real time');
  const after = await fetch(`${BASE}${r.data?.resolution_image_url}`);
  check(after.status === 200, 'resolution photo is served');

  section('Citizen reopens, worker fixes again, citizen confirms');
  r = await call('POST', `/complaints/${id}/verify`, { token: worker.token, json: { action: 'confirm' } });
  check(r.status === 403, 'only the reporting citizen can verify', r.status);
  r = await call('POST', `/complaints/${id}/verify`, { token: citizen.token, json: { action: 'reopen' } });
  check(r.status === 400, 'reopen without a reason rejected', r.status);
  r = await call('POST', `/complaints/${id}/verify`, { token: citizen.token, json: { action: 'reopen', feedback: 'Patch already cracked' } });
  check(r.status === 200 && r.data?.status === 'in_progress' && r.data?.citizen_confirmation_status === 'reopened', 'reopened -> back to in_progress', r);
  r = await call('GET', '/complaints/officer', { token: officer.token });
  check(r.data?.find((c) => c.id === id)?.citizen_feedback === 'Patch already cracked', 'officer sees the citizen feedback');
  r = await call('POST', `/complaints/${id}/resolve`, { token: worker.token, form: photo('resolution_image', 'after2.png', [0, 150, 0]) });
  check(r.status === 200 && r.data?.citizen_confirmation_status === 'pending' && r.data?.citizen_feedback === null, 're-resolved; feedback cleared, confirmation pending again', r);
  r = await call('POST', `/complaints/${id}/verify`, { token: citizen.token, json: { action: 'confirm' } });
  check(r.status === 200 && r.data?.status === 'resolved' && r.data?.citizen_confirmation_status === 'confirmed', 'citizen confirms the fix', r);
  r = await call('POST', `/complaints/${id}/verify`, { token: citizen.token, json: { action: 'reopen', feedback: 'again' } });
  check(r.status === 400, 'second verification rejected', r.status);
  r = await call('GET', '/complaints/my', { token: citizen.token });
  const mine = r.data?.find((c) => c.id === id);
  check(mine && mine.image_url && mine.resolution_image_url && mine.worker_name === worker.user?.name, 'citizen sees before/after photos and the worker name');

  section('Edge cases');
  r = await call('PATCH', '/complaints/999999/status', { token: officer.token, json: { status: 'open' } });
  check(r.status === 404, 'unknown complaint -> 404', r.status);
  r = await call('PATCH', '/complaints/abc/status', { token: officer.token, json: { status: 'open' } });
  check(r.status === 404, 'non-numeric complaint id -> 404', r.status);
  r = await call('PATCH', `/complaints/${id}/assign`, { token: officer.token, json: { worker_id: worker.user?.id } });
  check(r.status === 400, 'resolved complaint cannot be reassigned', r.status);

  socket.close();
  console.log(`\nIntegration test: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('Integration test crashed:', e); process.exit(2); });

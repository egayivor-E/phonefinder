/**
 * PhoneFinder server
 * ------------------
 * Consent-based "Find My Device" backend.
 * Devices only appear here if their owner signed in on the device itself
 * and explicitly enabled location sharing.
 *
 * Storage: PostgreSQL (Supabase in production — set DATABASE_URL).
 * Run:     npm install && npm start   (listens on PORT or 4000)
 */
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { all, get, run, initSchema } = require('./db');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set — using a random secret (all sessions reset on restart).');

const app = express();
app.use(cors());
app.use(express.json());
// Serve the web dashboard from the same origin (one URL for the whole system).
// Local dev: dashboard sits next to server/; on Render it's copied inside at build time.
const dashDir = [path.join(__dirname, 'dashboard'), path.join(__dirname, '..', 'dashboard')]
  .find((p) => fs.existsSync(p));
if (dashDir) app.use(express.static(dashDir));

// Async handler wrapper (Express 4 doesn't catch rejected promises).
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ---------- helpers ---------- */
const sign = (user) => jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

const userRow = (uid) => get('SELECT id, email, role, org_id, consent_at FROM users WHERE id = ?', uid);
const orgRow = (id) => (id == null ? Promise.resolve(null) : get('SELECT * FROM orgs WHERE id = ?', id));
const latestLocation = (deviceId) =>
  get('SELECT lat, lng, accuracy, battery, charging, ts FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT 1', deviceId);
const logAudit = (actorId, action, deviceId = null) =>
  run('INSERT INTO audit_log (actor_id, action, device_id) VALUES (?,?,?)', actorId, action, deviceId);

const ownDevice = ah(async (req, res, next) => {
  const dev = await get('SELECT * FROM devices WHERE id = ?', req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  if (String(dev.user_id) !== String(req.user.uid)) return res.status(403).json({ error: 'Not your device' });
  req.device = dev;
  next();
});

// Owner OR admin of the same org may manage (ring/lock/wipe/locate) a device.
const deviceAccess = ah(async (req, res, next) => {
  const u = await userRow(req.user.uid);
  const dev = await get('SELECT * FROM devices WHERE id = ?', req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  const owner = await userRow(dev.user_id);
  const allowed =
    String(dev.user_id) === String(u.id) ||
    (u.role === 'admin' && u.org_id != null && String(owner.org_id) === String(u.org_id));
  if (!allowed) return res.status(403).json({ error: 'Not allowed to manage this device' });
  req.device = dev;
  req.actor = u;
  next();
});

/* ---------- geofence evaluation (runs on every org location upload) ---------- */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function evaluateFences(deviceId, orgId, lat, lng) {
  const fences = await all('SELECT * FROM geofences WHERE org_id = ?', orgId);
  if (!fences.length) return;
  for (const f of fences) {
    const inside = haversineM(lat, lng, f.lat, f.lng) <= f.radius_m ? 1 : 0;
    const prev = await get('SELECT inside FROM fence_state WHERE device_id = ? AND fence_id = ?', deviceId, f.id);
    if (!prev) {
      await run('INSERT INTO fence_state (device_id, fence_id, inside) VALUES (?,?,?)', deviceId, f.id, inside);
      continue; // first observation: initialize silently
    }
    if (prev.inside === inside) continue;
    await run('UPDATE fence_state SET inside = ?, since = now() WHERE device_id = ? AND fence_id = ?', inside, deviceId, f.id);
    const kind = inside ? 'enter' : 'exit';
    if (f.mode !== 'both' && f.mode !== kind) continue;
    await run('INSERT INTO fence_events (org_id, fence_id, device_id, kind) VALUES (?,?,?,?)', orgId, f.id, deviceId, kind);
    await run("INSERT INTO commands (device_id, type, payload) VALUES (?, 'fence', ?)",
      deviceId, JSON.stringify({ kind, fence: f.name }));
    await logAudit(null, `fence.${kind}`, deviceId);
  }
  // Retention cap: keep the 500 most recent events per org.
  const keep = await get('SELECT MIN(id) AS min_id FROM (SELECT id FROM fence_events WHERE org_id = ? ORDER BY id DESC LIMIT 500) t', orgId);
  if (keep && keep.min_id) await run('DELETE FROM fence_events WHERE org_id = ? AND id < ?', orgId, keep.min_id);
}

/* ---------- auth ---------- */
app.post('/api/auth/register', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6)
    return res.status(400).json({ error: 'Email and a password of 6+ chars required' });
  const exists = await get('SELECT id FROM users WHERE email = ?', email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Account already exists' });
  const { rows } = await run('INSERT INTO users (email, password_hash) VALUES (?,?) RETURNING id',
    email.toLowerCase(), bcrypt.hashSync(password, 10));
  const user = { id: rows[0].id, email: email.toLowerCase() };
  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE email = ?', (email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
}));

/* ---------- organization (PhoneFinder Teams) ---------- */
app.get('/api/me', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  const org = await orgRow(u.org_id);
  res.json({
    user: { id: u.id, email: u.email, role: u.role, consent_at: u.consent_at },
    org: org ? { id: org.id, name: org.name, ...(u.role === 'admin' ? { invite_code: org.invite_code } : {}) } : null,
  });
}));

app.post('/api/orgs', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (u.org_id) return res.status(400).json({ error: 'Already in an organization — leave it first' });
  const name = ((req.body || {}).name || 'My Organization').trim().slice(0, 60);
  const { rows } = await run('INSERT INTO orgs (name, invite_code) VALUES (?,?) RETURNING id',
    name, crypto.randomBytes(4).toString('hex').toUpperCase());
  await run("UPDATE users SET org_id = ?, role = 'admin', consent_at = NULL WHERE id = ?", rows[0].id, u.id);
  const org = await orgRow(rows[0].id);
  logAudit(u.id, 'org.create');
  res.json({ org: { id: org.id, name: org.name, invite_code: org.invite_code } });
}));

app.post('/api/orgs/join', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (u.org_id) return res.status(400).json({ error: 'Already in an organization — leave it first' });
  const org = await get('SELECT * FROM orgs WHERE invite_code = ?', String((req.body || {}).code || '').trim().toUpperCase());
  if (!org) return res.status(404).json({ error: 'Invalid invite code' });
  await run("UPDATE users SET org_id = ?, role = 'member', consent_at = NULL WHERE id = ?", org.id, u.id);
  logAudit(u.id, 'org.join');
  res.json({ org: { id: org.id, name: org.name } });
}));

// Records the member's informed consent — this timestamp is the compliance trail.
app.post('/api/orgs/consent', auth, ah(async (req, res) => {
  await run('UPDATE users SET consent_at = now() WHERE id = ?', req.user.uid);
  logAudit(req.user.uid, 'consent');
  res.json({ ok: true });
}));

app.post('/api/orgs/leave', auth, ah(async (req, res) => {
  await run("UPDATE users SET org_id = NULL, role = 'member', consent_at = NULL WHERE id = ?", req.user.uid);
  logAudit(req.user.uid, 'org.leave');
  res.json({ ok: true });
}));

app.get('/api/org/members', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  res.json(await all('SELECT id, email, role, consent_at FROM users WHERE org_id = ? ORDER BY id', u.org_id));
}));

app.get('/api/org/devices', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  const rows = await all(`SELECT d.id, d.name, d.model, d.created_at,
                                 d.locked, d.lock_message, d.lock_contact, d.wiped_at,
                                 u.id AS owner_id, u.email AS owner_email
                          FROM devices d JOIN users u ON u.id = d.user_id
                          WHERE u.org_id = ? ORDER BY d.created_at DESC`, u.org_id);
  for (const d of rows) d.location = (await latestLocation(d.id)) || null;
  res.json(rows);
}));

/* ---------- devices ---------- */
app.get('/api/devices', auth, ah(async (req, res) => {
  const rows = await all(`SELECT id, name, model, created_at, locked, lock_message, lock_contact, wiped_at
                          FROM devices WHERE user_id = ? ORDER BY created_at DESC`, req.user.uid);
  for (const d of rows) d.location = (await latestLocation(d.id)) || null;
  res.json(rows);
}));

app.post('/api/devices', auth, ah(async (req, res) => {
  const { id, name, model } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  await run(`INSERT INTO devices (id, user_id, name, model) VALUES (?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, model = EXCLUDED.model, user_id = EXCLUDED.user_id`,
    id, req.user.uid, name, model || null);
  res.json({ ok: true });
}));

app.delete('/api/devices/:id', auth, ownDevice, ah(async (req, res) => {
  await run('DELETE FROM locations WHERE device_id = ?', req.device.id);
  await run('DELETE FROM commands  WHERE device_id = ?', req.device.id);
  await run('DELETE FROM devices   WHERE id = ?', req.device.id);
  res.json({ ok: true });
}));

/* ---------- location ---------- */
app.post('/api/devices/:id/location', auth, ownDevice, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  // Hard compliance gate: org members must have recorded consent before any
  // location data is accepted — enforced server-side, not just in the UI.
  if (u.org_id && !u.consent_at)
    return res.status(403).json({ error: 'Organizational tracking requires the user’s recorded consent' });
  if (req.device.wiped_at)
    return res.status(403).json({ error: 'Device has been wiped' });

  const { lat, lng, accuracy, battery, charging } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'lat/lng required' });
  await run('INSERT INTO locations (device_id, lat, lng, accuracy, battery, charging) VALUES (?,?,?,?,?,?)',
    req.device.id, lat, lng, accuracy ?? null, battery ?? null, charging ? 1 : 0);

  // Keep the table small: retain the 500 most recent points per device.
  const keep = await get('SELECT MIN(id) AS min_id FROM (SELECT id FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT 500) t', req.device.id);
  if (keep && keep.min_id) await run('DELETE FROM locations WHERE device_id = ? AND id < ?', req.device.id, keep.min_id);

  // Geofence evaluation — server-side, so alerts fire even if the app is closed.
  if (u.org_id) await evaluateFences(req.device.id, u.org_id, lat, lng);

  res.json({ ok: true });
}));

app.get('/api/devices/:id/history', auth, ownDevice, ah(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = await all('SELECT lat, lng, accuracy, battery, ts FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT ?',
    req.device.id, limit);
  res.json(rows.reverse());
}));

/* ---------- commands (ring) ---------- */
app.post('/api/devices/:id/ring', auth, deviceAccess, ah(async (req, res) => {
  await run("INSERT INTO commands (device_id, type) VALUES (?, 'ring')", req.device.id);
  logAudit(req.actor.id, 'ring', req.device.id);
  res.json({ ok: true });
}));

/* ---------- MDM-lite: remote lock / unlock / wipe / locate ---------- */
app.post('/api/devices/:id/lock', auth, deviceAccess, ah(async (req, res) => {
  const { message, contact, pin } = req.body || {};
  const msg = String(message || 'This device has been locked by your organization.').slice(0, 300);
  const tel = String(contact || '').slice(0, 60);
  const pinHash = pin ? bcrypt.hashSync(String(pin), 10) : null;
  await run('UPDATE devices SET locked = 1, lock_message = ?, lock_contact = ?, lock_pin_hash = ?, wiped_at = NULL WHERE id = ?',
    msg, tel, pinHash, req.device.id);
  await run("INSERT INTO commands (device_id, type, payload) VALUES (?, 'lock', ?)",
    req.device.id, JSON.stringify({ message: msg, contact: tel }));
  logAudit(req.actor.id, 'lock', req.device.id);
  res.json({ ok: true });
}));

app.post('/api/devices/:id/unlock', auth, deviceAccess, ah(async (req, res) => {
  // Org admins unlock remotely; everyone else needs the PIN (bcrypt-verified).
  if (req.actor.role !== 'admin') {
    const { pin } = req.body || {};
    if (!req.device.lock_pin_hash)
      return res.status(403).json({ error: 'No PIN was set — an admin must unlock this device remotely' });
    if (!bcrypt.compareSync(String(pin || ''), req.device.lock_pin_hash))
      return res.status(403).json({ error: 'Invalid PIN' });
  }
  await run('UPDATE devices SET locked = 0, lock_message = NULL, lock_contact = NULL, lock_pin_hash = NULL WHERE id = ?',
    req.device.id);
  await run("INSERT INTO commands (device_id, type) VALUES (?, 'unlock')", req.device.id);
  logAudit(req.actor.id, 'unlock', req.device.id);
  res.json({ ok: true });
}));

app.post('/api/devices/:id/wipe', auth, deviceAccess, ah(async (req, res) => {
  await run('UPDATE devices SET locked = 0, wiped_at = now() WHERE id = ?', req.device.id);
  await run("INSERT INTO commands (device_id, type) VALUES (?, 'wipe')", req.device.id);
  logAudit(req.actor.id, 'wipe', req.device.id);
  res.json({ ok: true });
}));

app.post('/api/devices/:id/locate', auth, deviceAccess, ah(async (req, res) => {
  await run("INSERT INTO commands (device_id, type) VALUES (?, 'locate')", req.device.id);
  logAudit(req.actor.id, 'locate', req.device.id);
  res.json({ ok: true });
}));

app.get('/api/devices/:id/commands', auth, ownDevice, ah(async (req, res) => {
  const pending = await all('SELECT id, type, payload FROM commands WHERE device_id = ? AND delivered = 0', req.device.id);
  if (pending.length) await run('UPDATE commands SET delivered = 1 WHERE device_id = ?', req.device.id);
  res.json(pending.map((c) => ({ type: c.type, payload: c.payload ? JSON.parse(c.payload) : null })));
}));

/* ---------- audit trail (admins) ---------- */
app.get('/api/org/audit', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id || u.role !== 'admin') return res.json([]);
  res.json(await all(`SELECT a.action, a.device_id, a.ts, COALESCE(u.email, 'system') AS actor
                      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                      ORDER BY a.id DESC LIMIT 200`));
}));

/* ---------- geofences ---------- */
app.get('/api/org/geofences', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  res.json(await all('SELECT id, name, lat, lng, radius_m, mode, created_at FROM geofences WHERE org_id = ? ORDER BY id', u.org_id));
}));

app.post('/api/org/geofences', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id) return res.status(400).json({ error: 'No organization' });
  if (u.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { name, lat, lng, radius_m, mode } = req.body || {};
  if (!name || typeof lat !== 'number' || typeof lng !== 'number' || !radius_m)
    return res.status(400).json({ error: 'name, lat, lng and radius_m are required' });
  const m = ['enter', 'exit', 'both'].includes(mode) ? mode : 'both';
  const { rows } = await run('INSERT INTO geofences (org_id, name, lat, lng, radius_m, mode, created_by) VALUES (?,?,?,?,?,?,?) RETURNING id',
    u.org_id, String(name).slice(0, 60), lat, lng, radius_m, m, u.id);
  logAudit(u.id, 'fence.create');
  res.json({ id: rows[0].id });
}));

app.delete('/api/org/geofences/:fid', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (u.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const f = await get('SELECT * FROM geofences WHERE id = ? AND org_id = ?', req.params.fid, u.org_id);
  if (!f) return res.status(404).json({ error: 'Fence not found' });
  await run('DELETE FROM fence_state WHERE fence_id = ?', f.id);
  await run('DELETE FROM geofences   WHERE id = ?', f.id);
  logAudit(u.id, 'fence.delete', null);
  res.json({ ok: true });
}));

app.get('/api/org/geofence-events', auth, ah(async (req, res) => {
  const u = await userRow(req.user.uid);
  if (!u.org_id || u.role !== 'admin') return res.json([]);
  res.json(await all(`SELECT e.id, e.kind, e.ts, f.name AS fence, d.name AS device, u.email AS owner
                      FROM fence_events e
                      LEFT JOIN geofences f ON f.id = e.fence_id
                      LEFT JOIN devices   d ON d.id = e.device_id
                      LEFT JOIN users     u ON u.id = d.user_id
                      WHERE e.org_id = ? ORDER BY e.id DESC LIMIT 100`, u.org_id));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'phonefinder', db: 'postgres' }));

/* ---------- boot ---------- */
initSchema()
  .then(() => app.listen(PORT, () => console.log(`PhoneFinder server running on http://0.0.0.0:${PORT}`)))
  .catch((e) => {
    console.error('Failed to initialize database:', e.message);
    process.exit(1);
  });

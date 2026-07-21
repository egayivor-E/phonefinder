/**
 * PhoneFinder server
 * ------------------
 * Consent-based "Find My Device" backend.
 * Devices only appear here if their owner signed in on the device itself
 * and explicitly enabled location sharing.
 *
 * Run:  npm install && npm start   (listens on :4000)
 */
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set — using a random secret (all sessions reset on restart).');

// Choose the database location. Prefer DB_PATH (e.g. a mounted Render Disk at
// /data); if that folder can't be created/written, fall back to a local file
// so the service still boots (data then won't survive restarts — attach a disk).
let dbPath = process.env.DB_PATH || path.join(__dirname, 'phonefinder.db');
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch (e) {
  const fallback = path.join(__dirname, 'phonefinder.db');
  console.warn(`⚠️  Cannot use ${dbPath} (${e.code || e.message}) — falling back to ${fallback}.`);
  console.warn('⚠️  Data will NOT survive restarts until a persistent disk is mounted at the DB_PATH folder.');
  dbPath = fallback;
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,            -- stable id generated on the device
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  model      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS locations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  lat       REAL NOT NULL,
  lng       REAL NOT NULL,
  accuracy  REAL,
  battery   REAL,
  charging  INTEGER DEFAULT 0,
  ts        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loc_device ON locations(device_id, ts);
CREATE TABLE IF NOT EXISTS commands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL,
  type       TEXT NOT NULL,               -- e.g. 'ring'
  created_at TEXT DEFAULT (datetime('now')),
  delivered  INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orgs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
`);

/* Idempotent org-related columns on users (safe for pre-existing databases). */
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('org_id'))     db.exec('ALTER TABLE users ADD COLUMN org_id INTEGER REFERENCES orgs(id)');
if (!userCols.includes('role'))       db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
if (!userCols.includes('consent_at')) db.exec('ALTER TABLE users ADD COLUMN consent_at TEXT');

/* ----- MDM-lite schema: device state + command payloads + audit trail ----- */
const devCols = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
if (!devCols.includes('locked'))         db.exec('ALTER TABLE devices ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
if (!devCols.includes('lock_message'))   db.exec('ALTER TABLE devices ADD COLUMN lock_message TEXT');
if (!devCols.includes('lock_contact'))   db.exec('ALTER TABLE devices ADD COLUMN lock_contact TEXT');
if (!devCols.includes('lock_pin_hash'))  db.exec('ALTER TABLE devices ADD COLUMN lock_pin_hash TEXT');
if (!devCols.includes('wiped_at'))       db.exec('ALTER TABLE devices ADD COLUMN wiped_at TEXT');
const cmdCols = db.prepare('PRAGMA table_info(commands)').all().map((c) => c.name);
if (!cmdCols.includes('payload'))        db.exec('ALTER TABLE commands ADD COLUMN payload TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id  INTEGER,
  action    TEXT NOT NULL,
  device_id TEXT,
  ts        TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS geofences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius_m   REAL NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'both',   -- 'enter' | 'exit' | 'both'
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fence_state (
  device_id TEXT NOT NULL,
  fence_id  INTEGER NOT NULL,
  inside    INTEGER NOT NULL,
  since     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, fence_id)
);
CREATE TABLE IF NOT EXISTS fence_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id    INTEGER NOT NULL,
  fence_id  INTEGER,
  device_id TEXT,
  kind      TEXT NOT NULL,                   -- 'enter' | 'exit'
  ts        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fence_events_org ON fence_events(org_id, id);`);
const logAudit = (actorId, action, deviceId = null) =>
  db.prepare('INSERT INTO audit_log (actor_id, action, device_id) VALUES (?,?,?)').run(actorId, action, deviceId);

/* ---------- geofence evaluation (runs on every org location upload) ---------- */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function evaluateFences(deviceId, orgId, lat, lng) {
  const fences = db.prepare('SELECT * FROM geofences WHERE org_id = ?').all(orgId);
  if (!fences.length) return;
  const getState = db.prepare('SELECT inside FROM fence_state WHERE device_id = ? AND fence_id = ?');
  const upsert = db.prepare(`INSERT INTO fence_state (device_id, fence_id, inside, since) VALUES (?, ?, ?, datetime('now'))
                             ON CONFLICT(device_id, fence_id) DO UPDATE SET inside = excluded.inside, since = datetime('now')`);
  for (const f of fences) {
    const inside = haversineM(lat, lng, f.lat, f.lng) <= f.radius_m ? 1 : 0;
    const prev = getState.get(deviceId, f.id);
    if (!prev) {
      upsert.run(deviceId, f.id, inside); // first observation: initialize silently
      continue;
    }
    if (prev.inside === inside) continue;
    upsert.run(deviceId, f.id, inside);
    const kind = inside ? 'enter' : 'exit';
    if (f.mode !== 'both' && f.mode !== kind) continue;
    db.prepare('INSERT INTO fence_events (org_id, fence_id, device_id, kind) VALUES (?,?,?,?)')
      .run(orgId, f.id, deviceId, kind);
    // Notify the device itself (driver awareness) via the command queue.
    db.prepare("INSERT INTO commands (device_id, type, payload) VALUES (?, 'fence', ?)")
      .run(deviceId, JSON.stringify({ kind, fence: f.name }));
    logAudit(null, `fence.${kind}`, deviceId);
  }
  // Retention cap: keep the 500 most recent events per org.
  db.prepare(`DELETE FROM fence_events WHERE org_id = ? AND id NOT IN
              (SELECT id FROM fence_events WHERE org_id = ? ORDER BY id DESC LIMIT 500)`).run(orgId, orgId);
}

const app = express();
app.use(cors());
app.use(express.json());
// Serve the web dashboard from the same origin (one URL for the whole system).
// Local dev: dashboard sits next to server/; on Render it's copied inside at build time.
const dashDir = [path.join(__dirname, 'dashboard'), path.join(__dirname, '..', 'dashboard')]
  .find((p) => fs.existsSync(p));
if (dashDir) app.use(express.static(dashDir));

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

function ownDevice(req, res, next) {
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  if (dev.user_id !== req.user.uid) return res.status(403).json({ error: 'Not your device' });
  req.device = dev;
  next();
}

const latestLocation = (deviceId) =>
  db.prepare('SELECT lat, lng, accuracy, battery, charging, ts FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT 1').get(deviceId);

const userRow = (uid) =>
  db.prepare('SELECT id, email, role, org_id, consent_at FROM users WHERE id = ?').get(uid);
const orgRow = (id) => (id == null ? null : db.prepare('SELECT * FROM orgs WHERE id = ?').get(id));

/* ---------- auth ---------- */
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6)
    return res.status(400).json({ error: 'Email and a password of 6+ chars required' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Account already exists' });
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email.toLowerCase(), bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, email: email.toLowerCase() };
  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: sign(user), user: { id: user.id, email: user.email } });
});

/* ---------- organization (PhoneFinder Teams) ----------
   Team tracking is transparent by design:
   - every member must record informed consent (consent_at) before their
     device may report location — enforced server-side, not just in the UI
   - the persistent on-device notification can't be hidden by the app
   - camera/mic/contacts/messages are never part of this API                */

app.get('/api/me', auth, (req, res) => {
  const u = userRow(req.user.uid);
  const org = orgRow(u.org_id);
  res.json({
    user: { id: u.id, email: u.email, role: u.role, consent_at: u.consent_at },
    org: org
      ? { id: org.id, name: org.name, ...(u.role === 'admin' ? { invite_code: org.invite_code } : {}) }
      : null,
  });
});

app.post('/api/orgs', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (u.org_id) return res.status(400).json({ error: 'Already in an organization — leave it first' });
  const name = ((req.body || {}).name || 'My Organization').trim().slice(0, 60);
  const info = db.prepare('INSERT INTO orgs (name, invite_code) VALUES (?, ?)')
    .run(name, crypto.randomBytes(4).toString('hex').toUpperCase());
  db.prepare("UPDATE users SET org_id = ?, role = 'admin', consent_at = NULL WHERE id = ?")
    .run(info.lastInsertRowid, u.id);
  const org = orgRow(info.lastInsertRowid);
  logAudit(u.id, 'org.create');
  res.json({ org: { id: org.id, name: org.name, invite_code: org.invite_code } });
});

app.post('/api/orgs/join', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (u.org_id) return res.status(400).json({ error: 'Already in an organization — leave it first' });
  const org = db.prepare('SELECT * FROM orgs WHERE invite_code = ?')
    .get(String((req.body || {}).code || '').trim().toUpperCase());
  if (!org) return res.status(404).json({ error: 'Invalid invite code' });
  db.prepare("UPDATE users SET org_id = ?, role = 'member', consent_at = NULL WHERE id = ?").run(org.id, u.id);
  logAudit(u.id, 'org.join');
  res.json({ org: { id: org.id, name: org.name } });
});

// Records the member's informed consent — this timestamp is the compliance trail.
app.post('/api/orgs/consent', auth, (req, res) => {
  db.prepare("UPDATE users SET consent_at = datetime('now') WHERE id = ?").run(req.user.uid);
  logAudit(req.user.uid, 'consent');
  res.json({ ok: true });
});

app.post('/api/orgs/leave', auth, (req, res) => {
  db.prepare("UPDATE users SET org_id = NULL, role = 'member', consent_at = NULL WHERE id = ?").run(req.user.uid);
  logAudit(req.user.uid, 'org.leave');
  res.json({ ok: true });
});

app.get('/api/org/members', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  res.json(db.prepare('SELECT id, email, role, consent_at FROM users WHERE org_id = ? ORDER BY id').all(u.org_id));
});

// Every org member sees the team map (mutual transparency); locations only
// exist for users who consented AND enabled sharing on a device.
app.get('/api/org/devices', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  const rows = db.prepare(`SELECT d.id, d.name, d.model, d.created_at,
                                  d.locked, d.lock_message, d.lock_contact, d.wiped_at,
                                  u.id AS owner_id, u.email AS owner_email
                           FROM devices d JOIN users u ON u.id = d.user_id
                           WHERE u.org_id = ? ORDER BY d.created_at DESC`).all(u.org_id);
  res.json(rows.map((d) => ({ ...d, location: latestLocation(d.id) || null })));
});

/* ---------- devices ---------- */
app.get('/api/devices', auth, (req, res) => {
  const rows = db.prepare(`SELECT id, name, model, created_at, locked, lock_message, lock_contact, wiped_at
                           FROM devices WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.uid);
  res.json(rows.map((d) => ({ ...d, location: latestLocation(d.id) || null })));
});

// Register (or re-register) the physical device the app is running on.
app.post('/api/devices', auth, (req, res) => {
  const { id, name, model } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  db.prepare(`INSERT INTO devices (id, user_id, name, model) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, model = excluded.model, user_id = excluded.user_id`)
    .run(id, req.user.uid, name, model || null);
  res.json({ ok: true });
});

app.delete('/api/devices/:id', auth, ownDevice, (req, res) => {
  db.prepare('DELETE FROM locations WHERE device_id = ?').run(req.device.id);
  db.prepare('DELETE FROM commands  WHERE device_id = ?').run(req.device.id);
  db.prepare('DELETE FROM devices   WHERE id = ?').run(req.device.id);
  res.json({ ok: true });
});

/* ---------- location ---------- */
app.post('/api/devices/:id/location', auth, ownDevice, (req, res) => {
  // Hard compliance gate: while a user belongs to an organization, NO location
  // data is accepted unless they have recorded informed consent.
  const u = userRow(req.user.uid);
  if (u.org_id && !u.consent_at)
    return res.status(403).json({ error: 'Organizational tracking requires the user’s recorded consent' });
  if (req.device.wiped_at)
    return res.status(403).json({ error: 'Device has been wiped' });

  const { lat, lng, accuracy, battery, charging } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'lat/lng required' });
  db.prepare('INSERT INTO locations (device_id, lat, lng, accuracy, battery, charging) VALUES (?,?,?,?,?,?)')
    .run(req.device.id, lat, lng, accuracy ?? null, battery ?? null, charging ? 1 : 0);
  // Keep the table small: retain the 500 most recent points per device.
  db.prepare(`DELETE FROM locations WHERE device_id = ? AND id NOT IN (
                SELECT id FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT 500)`)
    .run(req.device.id, req.device.id);

  // Geofence evaluation for org devices — server-side, so alerts fire even if
  // the app is closed or modified.
  if (u.org_id) evaluateFences(req.device.id, u.org_id, lat, lng);

  res.json({ ok: true });
});

app.get('/api/devices/:id/history', auth, ownDevice, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare('SELECT lat, lng, accuracy, battery, ts FROM locations WHERE device_id = ? ORDER BY id DESC LIMIT ?')
    .all(req.device.id, limit);
  res.json(rows.reverse());
});

/* ---------- commands (ring) ----------
   You may ring your own devices; an org admin may ring any device enrolled
   in the same organization. */
app.post('/api/devices/:id/ring', auth, (req, res) => {
  const u = userRow(req.user.uid);
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  const owner = userRow(dev.user_id);
  const allowed = dev.user_id === u.id || (u.role === 'admin' && u.org_id != null && owner.org_id === u.org_id);
  if (!allowed) return res.status(403).json({ error: 'Not allowed to ring this device' });
  db.prepare("INSERT INTO commands (device_id, type) VALUES (?, 'ring')").run(dev.id);
  logAudit(u.id, 'ring', dev.id);
  res.json({ ok: true });
});

/* ---------- MDM-lite: remote lock / unlock / wipe / locate ---------- */

function deviceAccess(req, res, next) {
  const u = userRow(req.user.uid);
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  const owner = userRow(dev.user_id);
  const allowed = dev.user_id === u.id || (u.role === 'admin' && u.org_id != null && owner.org_id === u.org_id);
  if (!allowed) return res.status(403).json({ error: 'Not allowed to manage this device' });
  req.device = dev;
  req.actor = u;
  next();
}

// Lost-mode lock: takes over the device screen with a message + contact + PIN.
app.post('/api/devices/:id/lock', auth, deviceAccess, (req, res) => {
  const { message, contact, pin } = req.body || {};
  const msg = String(message || 'This device has been locked by your organization.').slice(0, 300);
  const tel = String(contact || '').slice(0, 60);
  const pinHash = pin ? bcrypt.hashSync(String(pin), 10) : null;
  db.prepare('UPDATE devices SET locked = 1, lock_message = ?, lock_contact = ?, lock_pin_hash = ?, wiped_at = NULL WHERE id = ?')
    .run(msg, tel, pinHash, req.device.id);
  db.prepare('INSERT INTO commands (device_id, type, payload) VALUES (?, ?, ?)')
    .run(req.device.id, 'lock', JSON.stringify({ message: msg, contact: tel }));
  logAudit(req.actor.id, 'lock', req.device.id);
  res.json({ ok: true });
});

// Unlock: org admins unlock remotely without a PIN (their authority).
// Everyone else — including the device's own signed-in app — must present the
// PIN set at lock time; otherwise anyone holding the phone could dismiss the
// lock screen. PIN verification happens server-side (bcrypt).
app.post('/api/devices/:id/unlock', auth, deviceAccess, (req, res) => {
  if (req.actor.role !== 'admin') {
    const { pin } = req.body || {};
    if (!req.device.lock_pin_hash)
      return res.status(403).json({ error: 'No PIN was set — an admin must unlock this device remotely' });
    if (!bcrypt.compareSync(String(pin || ''), req.device.lock_pin_hash))
      return res.status(403).json({ error: 'Invalid PIN' });
  }
  db.prepare('UPDATE devices SET locked = 0, lock_message = NULL, lock_contact = NULL, lock_pin_hash = NULL WHERE id = ?')
    .run(req.device.id);
  db.prepare("INSERT INTO commands (device_id, type) VALUES (?, 'unlock')").run(req.device.id);
  logAudit(req.actor.id, 'unlock', req.device.id);
  res.json({ ok: true });
});

// Selective (corporate) wipe: revokes the app's account & data on the device.
app.post('/api/devices/:id/wipe', auth, deviceAccess, (req, res) => {
  db.prepare("UPDATE devices SET locked = 0, wiped_at = datetime('now') WHERE id = ?").run(req.device.id);
  db.prepare("INSERT INTO commands (device_id, type) VALUES (?, 'wipe')").run(req.device.id);
  logAudit(req.actor.id, 'wipe', req.device.id);
  res.json({ ok: true });
});

// Force an immediate GPS fix.
app.post('/api/devices/:id/locate', auth, deviceAccess, (req, res) => {
  db.prepare("INSERT INTO commands (device_id, type) VALUES (?, 'locate')").run(req.device.id);
  logAudit(req.actor.id, 'locate', req.device.id);
  res.json({ ok: true });
});

// The device app polls this; returns & clears pending commands.
app.get('/api/devices/:id/commands', auth, ownDevice, (req, res) => {
  const pending = db.prepare('SELECT id, type, payload FROM commands WHERE device_id = ? AND delivered = 0').all(req.device.id);
  if (pending.length) db.prepare('UPDATE commands SET delivered = 1 WHERE device_id = ?').run(req.device.id);
  res.json(pending.map((c) => ({ type: c.type, payload: c.payload ? JSON.parse(c.payload) : null })));
});

// Audit trail — admins only (Act 843 accountability).
app.get('/api/org/audit', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id || u.role !== 'admin') return res.json([]);
  res.json(db.prepare(`SELECT a.action, a.device_id, a.ts, COALESCE(u.email, 'system') AS actor
                       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                       ORDER BY a.id DESC LIMIT 200`).all());
});

/* ---------- geofences ---------- */
app.get('/api/org/geofences', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id) return res.json([]);
  res.json(db.prepare('SELECT id, name, lat, lng, radius_m, mode, created_at FROM geofences WHERE org_id = ? ORDER BY id').all(u.org_id));
});

app.post('/api/org/geofences', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id) return res.status(400).json({ error: 'No organization' });
  if (u.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { name, lat, lng, radius_m, mode } = req.body || {};
  if (!name || typeof lat !== 'number' || typeof lng !== 'number' || !radius_m)
    return res.status(400).json({ error: 'name, lat, lng and radius_m are required' });
  const m = ['enter', 'exit', 'both'].includes(mode) ? mode : 'both';
  const info = db.prepare('INSERT INTO geofences (org_id, name, lat, lng, radius_m, mode, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(u.org_id, String(name).slice(0, 60), lat, lng, radius_m, m, u.id);
  logAudit(u.id, 'fence.create');
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/org/geofences/:fid', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (u.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const f = db.prepare('SELECT * FROM geofences WHERE id = ? AND org_id = ?').get(req.params.fid, u.org_id);
  if (!f) return res.status(404).json({ error: 'Fence not found' });
  db.prepare('DELETE FROM fence_state  WHERE fence_id = ?').run(f.id);
  db.prepare('DELETE FROM geofences    WHERE id = ?').run(f.id);
  logAudit(u.id, 'fence.delete', null);
  res.json({ ok: true });
});

app.get('/api/org/geofence-events', auth, (req, res) => {
  const u = userRow(req.user.uid);
  if (!u.org_id || u.role !== 'admin') return res.json([]);
  res.json(db.prepare(`SELECT e.id, e.kind, e.ts, f.name AS fence, d.name AS device, u.email AS owner
                       FROM fence_events e
                       LEFT JOIN geofences f ON f.id = e.fence_id
                       LEFT JOIN devices   d ON d.id = e.device_id
                       LEFT JOIN users     u ON u.id = d.user_id
                       WHERE e.org_id = ? ORDER BY e.id DESC LIMIT 100`).all(u.org_id));
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'phonefinder' }));

app.listen(PORT, () => console.log(`PhoneFinder server running on http://0.0.0.0:${PORT}`));

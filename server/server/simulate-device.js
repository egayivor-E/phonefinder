/**
 * Virtual test device — lets you test the whole system in VS Code WITHOUT a phone.
 *
 * Registers an account + device, joins/creates an organization, records consent,
 * then drives a virtual vehicle back and forth across Accra (Osu ⇄ Airport City)
 * reporting GPS every 5 seconds. Any commands the dashboard sends (ring, lock,
 * locate, fence alerts, wipe) are printed to the console.
 *
 * Usage:
 *   node simulate-device.js <email> <password> [inviteCode]
 *
 * Examples:
 *   node simulate-device.js sim@test.com secret123          # creates a new org
 *   node simulate-device.js sim@test.com secret123 AB12CD34  # joins YOUR org
 *
 * Env: API_BASE=http://localhost:4000 (default)
 */
const API = process.env.API_BASE || 'http://localhost:4000';
const [, , email, password, inviteCode] = process.argv;

if (!email || !password) {
  console.log('Usage: node simulate-device.js <email> <password> [inviteCode]');
  process.exit(1);
}

let token = null;
const deviceId = 'sim-' + Math.random().toString(36).slice(2, 8);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* Route: ping-pong between Osu and Airport City, 120 steps each leg. */
const A = { lat: 5.556, lng: -0.197 };   // Osu
const B = { lat: 5.6037, lng: -0.187 };  // Airport City
const STEPS = 120;
let step = 0;
let dir = 1;
let battery = 92;

function nextPosition() {
  step += dir;
  if (step >= STEPS) dir = -1;
  if (step <= 0) dir = 1;
  const t = step / STEPS;
  // small jitter so the marker looks alive
  const jitter = () => (Math.random() - 0.5) * 0.0004;
  return {
    lat: A.lat + (B.lat - A.lat) * t + jitter(),
    lng: A.lng + (B.lng - A.lng) * t + jitter(),
  };
}

async function main() {
  console.log(`\n📡 Virtual device ${deviceId} → server ${API}\n`);

  // 1. Sign in (or register)
  try {
    token = (await api('/api/auth/login', { method: 'POST', body: { email, password } })).token;
    console.log(`✅ Signed in as ${email}`);
  } catch {
    token = (await api('/api/auth/register', { method: 'POST', body: { email, password } })).token;
    console.log(`✅ Registered account ${email}`);
  }

  // 2. Organization
  let me = await api('/api/me');
  if (!me.org) {
    if (inviteCode) {
      await api('/api/orgs/join', { method: 'POST', body: { code: inviteCode } });
      console.log(`✅ Joined organization with code ${inviteCode}`);
    } else {
      const res = await api('/api/orgs', { method: 'POST', body: { name: 'Sim Test Org' } });
      console.log(`✅ Created organization "${res.org.name}" — invite code: ${res.org.invite_code}`);
      console.log(`   (join this org from the dashboard or a real phone with that code)`);
    }
    me = await api('/api/me');
  } else {
    console.log(`✅ In organization "${me.org.name}"`);
  }

  // 3. Consent
  if (!me.user.consent_at) {
    await api('/api/orgs/consent', { method: 'POST' });
    console.log('✅ Consent recorded');
  }

  // 4. Register the virtual device
  await api('/api/devices', { method: 'POST', body: { id: deviceId, name: 'Sim Van (virtual)', model: 'Simulator' } });
  console.log('✅ Device registered — open the dashboard and watch it move:\n   ' + API + '\n');

  // 5. Drive the route
  const tick = async () => {
    try {
      const pos = nextPosition();
      battery = Math.max(5, battery - 0.05);
      await api(`/api/devices/${deviceId}/location`, {
        method: 'POST',
        body: { lat: pos.lat, lng: pos.lng, accuracy: 8 + Math.random() * 6, battery: Math.round(battery), charging: false },
      });
      const leg = dir === 1 ? 'Osu→Airport' : 'Airport→Osu';
      console.log(`🚐 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}  🔋${Math.round(battery)}%  ${leg}  (${step}/${STEPS})`);

      // Collect commands from the dashboard
      const cmds = await api(`/api/devices/${deviceId}/commands`);
      for (const c of cmds) {
        if (c.type === 'ring')  console.log('\n🔊 >>> RING command received — phone would now be screaming\n');
        if (c.type === 'lock')  console.log(`\n🔒 >>> LOCK command received — screen locked. Message: "${c.payload?.message}" Contact: ${c.payload?.contact}\n`);
        if (c.type === 'unlock') console.log('\n🔓 >>> UNLOCK command received\n');
        if (c.type === 'locate') console.log('\n📍 >>> LOCATE command received — immediate fix already sent\n');
        if (c.type === 'fence') console.log(`\n⭕ >>> GEOFENCE alert: ${c.payload?.kind === 'exit' ? 'LEFT' : 'ENTERED'} zone "${c.payload?.fence}"\n`);
        if (c.type === 'wipe') {
          console.log('\n🧹 >>> WIPE command received — virtual device de-enrolled. Simulator stopping.\n');
          process.exit(0);
        }
      }
    } catch (e) {
      if (/wiped/i.test(e.message)) {
        console.log('\n🧹 Server says device is wiped — simulator stopping.\n');
        process.exit(0);
      }
      console.log(`⚠️  ${e.message} (will retry)`);
    }
  };

  await tick();
  setInterval(tick, 5000);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});

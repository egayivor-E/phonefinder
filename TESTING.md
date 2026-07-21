# 🧪 Testing PhoneFinder in Visual Studio Code

A complete local test run — from zero to "every feature proven" — using only
VS Code and (optionally) one Android phone. Do this **before** deploying.

**Prerequisites**
- [Node.js 18+](https://nodejs.org) (`node --version` to check)
- [VS Code](https://code.visualstudio.com)
- Optional: an Android phone with the **Expo Go** app (Play Store) for Level 3

---

## 0. Open the project

1. VS Code → **File → Open Folder** → select the `phonefinder` folder.
2. Open the integrated terminal: **Terminal → New Terminal** (or `` Ctrl+` ``).
3. Nice-to-have extensions: *Expo Tools*, *Docker*.

You'll use **two terminals** (click the **+** icon next to the terminal panel):
- **Terminal 1** = the server
- **Terminal 2** = the simulator or the mobile app

---

## Level 1 — Server & API (2 minutes, no phone)

**Terminal 1:**
```bash
cd server
npm install
npm start          # → "PhoneFinder server running on http://0.0.0.0:4000"
```

**Verify** (Terminal 2):
```bash
curl http://localhost:4000/api/health
# → {"ok":true,"service":"phonefinder"}
```

Open **http://localhost:4000** in your browser — the dashboard loads (the
server serves it). Click *"Create an account"* → any email + password (6+ chars).
You're signed in with an empty device list. ✅

> Leave the server running for the rest of the tests.

---

## Level 2 — Full system test with a VIRTUAL device (5 minutes, no phone)

A simulator script drives a virtual van back and forth across Accra
(Osu ⇄ Airport City), reporting GPS every 5 seconds — so you can test the
entire product without any hardware.

### 1. Start the virtual van (Terminal 2)

```bash
cd server
node simulate-device.js sim@test.com secret123
```

It prints `✅ Created organization "Sim Test Org" — invite code: XXXXXXXX`.

### 2. Watch it live

In the dashboard (**http://localhost:4000** — sign in with `sim@test.com` /
`secret123`):

- [ ] A **blue marker** appears and moves along the Osu→Airport road, refreshing every 10s
- [ ] Battery % ticks down; "seen just now" stays fresh

### 3. Test directions

- [ ] Click the device → **🧭 Directions** → allow browser location → a cyan route
      draws with km + minutes; **🚗 Navigate** opens Google Maps

### 4. Test geofences

- [ ] Click **＋ New zone** → name `Osu Depot` → lat `5.556`, lng `-0.197`,
      radius `300`, mode `both`
- [ ] An **amber dashed circle** appears on the map
- [ ] Wait — when the van crosses the boundary the **🚨 Zone alerts** panel
      flashes and beeps: 🔴 EXIT … and later 🟢 ENTER
- [ ] The simulator's terminal also prints `⭕ >>> GEOFENCE alert: LEFT zone "Osu Depot"`

### 5. Test remote controls

In the dashboard's device card (or the map screen):

| Action | Expected result |
|---|---|
| 🔊 **Ring** | Simulator terminal prints `🔊 >>> RING command received` |
| 🔒 **Lock** (message "Return to HQ", contact "+233 20 000 0000", PIN `4821`) | Simulator prints the lock payload; device shows **🔒 LOCKED** badge |
| 🔓 **Unlock** | Badge clears |
| 📍 **Locate** | Simulator prints `📍 >>> LOCATE command received` |
| 🧹 **Wipe** | Simulator prints `🧹 >>> WIPE command received` **and exits**; badge shows **🧹 WIPED**; further location uploads are rejected |

### 6. Check the audit trail

- [ ] **📜 Audit log** lists lock, unlock, wipe, ring, locate, consent, org.create
      with actor + timestamp

Ctrl+C the simulator when done.

---

## Level 3 — Real phone test with Expo Go (15 minutes)

Now the real thing: a physical phone sharing live GPS.

### 1. Point the app at your computer

The phone needs your computer's **LAN IP** (not localhost — that's the phone
itself!). Find it:
- Windows: `ipconfig` → *IPv4 Address* (e.g. `192.168.1.42`)
- Mac/Linux: `ifconfig` or `hostname -I`

Edit **`app/src/config.ts`**:
```ts
export const config = {
  API_BASE: 'http://192.168.1.42:4000',   // ← your computer's LAN IP
};
```
Make sure the **phone and computer are on the same WiFi**, and your firewall
allows port 4000 (Windows may prompt — click *Allow*).

### 2. Start the app (Terminal 2)

```bash
cd app
npm install
npx expo start --lan
```
Scan the QR code with **Expo Go** on the phone. The app loads.

### 3. Walk the full user journey

**On the phone:**
- [ ] Create a *second* account (e.g. `driver@test.com`) — or reuse `sim@test.com`
- [ ] PhoneFinder Teams → **Join organization** → enter the invite code from the dashboard

  *(If the sim org is gone: sign in on the dashboard as `sim@test.com` — the
  invite code is shown at the top — or create a fresh org from the phone.)*
- [ ] Read the disclosure → **I understand and consent**
- [ ] Switch on **🛡️ Protect this phone** → grant location permissions
      (choose **Allow all the time** for background tracking)
- [ ] A persistent notification appears: *"PhoneFinder is protecting this device"*

**On the dashboard** (sign in with the ADMIN account):
- [ ] The phone appears on the map within ~15s — walk around and watch it move
- [ ] **🧭 Directions** to the phone from where you sit
- [ ] **🔊 Ring** → the phone takes over: red screen, vibration, spoken
      *"This phone has been reported lost…"* → tap *"I found this phone"* to stop
- [ ] **🔒 Lock** (PIN `4821`) → phone shows the lock screen with your message;
      wrong PIN fails, `4821` unlocks it
- [ ] Create a **geofence around your current room** (use the device chip to grab
      coords, radius 30 m) → walk out → dashboard alert fires, phone shows a toast
- [ ] **🧹 Wipe** → the app signs out and stops sharing entirely

### Troubleshooting

| Problem | Fix |
|---|---|
| Phone says "Cannot reach the server" | Wrong IP in `config.ts`; different WiFi; firewall blocking 4000; restart `expo start --lan` |
| QR scan does nothing | Expo Go and the app must be on the same Expo SDK — `npm install` first |
| Location never appears | Permission set to "only this time" — choose *Always*; toggle Protect off/on |
| Map tiles blank (in preview) | Open the dashboard in a real browser, not an embedded preview |
| Background sharing stops when screen off | Expo Go limits background work — normal; EAS builds (DEPLOY.md) fix this |

### No Android phone available?

Install **Android Studio** → create a virtual device (AVD) → run
`npx expo start --android` and set `API_BASE` to `http://10.0.2.2:4000`
(the emulator's alias for your computer). In the emulator, set a mock location
via *Extended controls → Location* to simulate movement.

---

## ✅ Pre-deployment sign-off

| Area | Pass |
|---|---|
| Server health + dashboard loads | ☐ |
| Account + organization + invite flow | ☐ |
| Consent gate enforced (no consent → no tracking) | ☐ |
| Live location + directions + navigate | ☐ |
| Ring / Lock (PIN) / Unlock / Wipe | ☐ |
| Geofence enter + exit alerts (dashboard beep + on-device) | ☐ |
| Audit log records everything | ☐ |
| Member cannot manage devices outside their authority | ☐ |
| Real phone (or emulator) shares GPS and survives screen-off for a few minutes | ☐ |

All boxes ticked? → continue with **[DEPLOY.md](DEPLOY.md)**.

# 📡 PhoneFinder — Find My Device

A consent-based "Find My Device" system: locate **your own** phone on a live map,
get driving directions to it, make it ring with a loud spoken alarm, and see its
battery level — from the cross-platform mobile app or any web browser.

> ### ⚖️ Consent & legality
> PhoneFinder only tracks devices that are **signed in to your own account** with
> location sharing **explicitly switched on** on the device itself. While sharing,
> the phone shows a persistent "PhoneFinder is protecting this device" notification
> (and the iOS blue location pill) so tracking is never covert.
>
> Tracking *someone else's* phone without their knowledge is illegal in most
> countries (stalking / wiretap / privacy laws). This project does not support that
> and cannot — there is no public system that turns an arbitrary phone number into a
> live GPS location; that data only exists inside telecom carrier networks and is
> released solely to law enforcement with a warrant.

## ✨ Features

| Feature | Where |
|---|---|
| Live location on a map (auto-refreshes every 10s) | App + Dashboard |
| Accuracy circle, battery %, charging state, last-seen time | App + Dashboard |
| 🧭 Directions — route drawn on the map with distance & ETA (OSRM) | App + Dashboard |
| 🚗 Navigate — hands off to Google Maps / Apple Maps turn-by-turn | App + Dashboard |
| 🔊 Ring my phone — full-screen red alarm, vibration + spoken "this phone is lost" loop | App |
| 🔒 Remote lock (Lost Mode), 🧹 selective wipe, 📍 locate-now — full MDM-lite suite | App + Dashboard |
| ⭕ Geofence zones with live enter/exit alerts, zone circles on the map, on-device notifications | Server + App + Dashboard |
| 📜 Audit trail of every admin action | Dashboard |
| Background location sharing with foreground-service notification | Android + iOS |
| Location history trail (server keeps last 500 points per device) | API |
| Multi-device — track your phone, tablet, old backup phone… | App + Dashboard |

## 🏗️ Architecture

```
┌─────────────────────┐         HTTPS/JSON          ┌──────────────────────┐
│  PhoneFinder App    │ ──── location updates ────▶ │   PhoneFinder Server │
│  (Expo / React      │ ◀──── ring commands ─────── │   Node.js +          │
│   Native: iOS +     │                             │   PostgreSQL         │
│   Android)          │                             │   (Supabase)         │
└─────────────────────┘                             └──────────┬───────────┘
        ▲                                                      │
        │ find my phone                                        │ same API
        │                                                      ▼
        └──────────────────────────────────────  Web Dashboard (Leaflet)
```

## 🧪 Testing

Before deploying, run the full local test suite in VS Code — including a
**virtual device simulator** that drives a van across Accra so you can test
live tracking, geofences, ring, lock and wipe with zero hardware:
**[TESTING.md](TESTING.md)**.

## 📦 Deployment

Production deployment (Docker one-liner or Render/Railway) and building an
installable **Android APK** via EAS are covered step-by-step in **[DEPLOY.md](DEPLOY.md)**.

TL;DR:
```bash
cp .env.example .env            # set JWT_SECRET
docker compose up -d --build    # dashboard + API at http://YOUR_SERVER:4000
cd app && npm run build:apk     # cloud build → downloadable APK for your team
```

## 🚀 Quickstart

### 1. Start the server

```bash
cd phonefinder/server
npm install
npm start          # → http://localhost:4000
```

### 2. Try the web dashboard (instant demo)

Open `phonefinder/dashboard/index.html` **in a real browser** (double-click it —
the in-app preview can't load the map tiles, but the file itself works perfectly).

1. Server URL: `http://localhost:4000`
2. Click *"Create an account"* → enter email + password (6+ chars)
3. You'll see "No devices yet" until the mobile app reports in ⬇️

### 3. Run the mobile app

```bash
cd phonefinder/app
npm install
npx expo start --lan
```

1. Open `src/config.ts` and set `API_BASE`:
   - **Physical phone:** `http://YOUR_COMPUTER_LAN_IP:4000` (phone & PC on same WiFi)
   - **Android emulator:** `http://10.0.2.2:4000`
   - **Remote / mobile data:** run `ngrok http 4000` and use the `https://…ngrok-free.app` URL
2. Scan the QR code with **Expo Go** (Android / iOS).
3. Sign in with the **same account** you created in the dashboard.
4. Switch on **"🛡️ Protect this phone"** → grant location permissions (choose
   *Always* for background tracking).
5. Go back to the dashboard → your phone appears on the map within ~15 seconds.
   Hit **🧭 Directions**, **🚗 Navigate**, or **🔊 Ring**.

### 4. Production builds (real background reliability)

Expo Go is great for development, but for dependable *background* location
(especially iOS "Always" tracking and Android foreground services) create a
development/production build:

```bash
npm install -g eas-cli
eas build --profile development --platform android   # and ios
```

`app.json` already declares all required permissions and background modes.

## 🏢 PhoneFinder Teams (organizational use)

Track your organization's **enrolled devices** on a live team map — built for
field teams, drivers, security staff and company phones.

### How it works

1. **Admin** signs in → *PhoneFinder Teams → Create organization* → gets an 8-char invite code.
2. **Members** install the app, sign in, *Join organization* with the code.
3. Every member — **including the admin** — must read and accept the tracking
   disclosure. Their acceptance is stored with a timestamp (`consent_at`).
4. Members switch on *"Protect this phone"* → they appear on the team map.
5. **Everyone sees the team map** (mutual transparency). Directions and Navigate
   work for any team device. Only **admins** can ring other members' devices.
6. The admin dashboard lists every member's **consent record** — your evidence
   that tracking was disclosed and agreed.

The web dashboard automatically switches to the team map when you sign in with
an org account.

### Compliance guardrails (deliberately non-removable)

| Guardrail | Enforcement |
|---|---|
| Recorded informed consent before any location data flows | **Server-side**: `POST /location` returns 403 until `consent_at` is set — a modified app cannot bypass it |
| No covert mode | Persistent Android foreground-service notification + iOS blue location pill, always visible while sharing |
| No camera, microphone, photos, contacts or message access | The API only accepts lat/lng/accuracy/battery — nothing else is ever collected |
| Stop anytime | Members toggle sharing off or leave the org; admin ring is admin-only |
| No "track any phone number" | Only devices signed in with an org account and enrolled by their user can appear |

### 🇬🇭 Legal checklist for Ghana (Data Protection Act, 2012 — Act 843)

Your internal approval is necessary but not sufficient. Before going live:

1. **Register with the Data Protection Commission** as a data controller *before*
   processing begins — processing personal data without registration is a
   criminal offence (fine up to 250 penalty units and/or up to 2 years).
   → [www.dataprotection.org.gh](https://www.dataprotection.org.gh)
2. **Notify data subjects** — the app's mandatory disclosure screen does this
   per device; back it up with a written employee policy.
3. **Lawful basis** — rely on consent (recorded by the app) and/or necessity
   for the employment relationship; state it in your policy.
4. **Keep records** — the server stores consent timestamps and location history
   (capped at 500 points per device); export/back them up.
5. **Security** — run the server over HTTPS with a strong `JWT_SECRET`.
6. **Breach reporting** — notify the DPC and affected staff promptly if the
   server is ever compromised.

> Need more than location (remote wipe, app blocking, fully managed devices)?
> That's MDM territory — look at Microsoft Intune, Hexnode or Scalefusion.
> PhoneFinder Teams is purpose-built for transparent location tracking only.

## 🛡️ MDM-lite: remote lock, wipe & device control

Management features for enrolled, consented devices — controlled from the app's
map screen or the web dashboard (owner or org admin):

| Feature | What it does | Where |
|---|---|---|
| 🔒 **Remote lock** | Takes over the device screen with your message + contact number; unlockable only with the PIN you set (bcrypt-verified server-side) or by an admin. Location sharing keeps running so the device can be recovered. Back button blocked on Android. | App map screen → Lock; Dashboard → Lock |
| 🔓 **Unlock** | Admins unlock remotely without a PIN; the person holding the device enters the PIN on the lock screen. | App + Dashboard |
| 🧹 **Remote wipe** | *Selective (corporate) wipe*: stops sharing, erases the app's account/data and de-enrolls the device. Personal data on the phone is never touched (BYOD-safe). | App + Dashboard |
| 📍 **Locate now** | Forces an immediate GPS fix instead of waiting for the next 15s update. | App + Dashboard |
| 🛡️ **Posture** | `🔒 LOCKED` / `🧹 WIPED` badges on every device card, list and popup. | App + Dashboard |
| 📜 **Audit log** | Every action (lock, unlock, wipe, ring, locate, join, consent…) is recorded with actor + timestamp; admins see it in the dashboard. | Server + Dashboard |

**Security model:** management commands are authorized server-side (owner or
org admin only — verified in tests), PIN checks happen server-side so a
modified app can't bypass the lock screen, and wiped devices are refused
further location uploads.

### Honest limits — and when to graduate to full MDM

This is app-level management, not OS-level MDM. A determined user can
force-stop any regular app. That's fine for honest lost-device recovery and
consented team tracking; it is *not* a control for hostile users. When you need
true device control — enforced kiosk mode, factory reset, silent app
install/uninstall, blocking factory reset — use:

- **Android Enterprise device owner**: provision devices via QR/zero-touch and
  use `DevicePolicyManager` (lock task mode, `wipeData()`). Requires a native
  module — Expo prebuild with e.g. `react-native-device-admin`, or a dedicated
  kiosk launcher like **Headwind MDM** (open source, self-hostable).
- **iOS**: MDM only — requires Apple Business Manager + the MDM protocol via a
  vendor (Intune, Hexnode, Kandji, Scalefusion, Mosyle). No app can do this.
- **Hosted options**: Hexnode and Scalefusion have generous free tiers and
  cover Android + iOS fully.

PhoneFinder Teams pairs well with them: use MDM for enforcement, PhoneFinder
for the live team map, directions and lost-mode workflow.

## 🔐 Production checklist

- Host the database on **Supabase** (free tier) and set `DATABASE_URL`
- Set a real secret: `JWT_SECRET=...`
- Serve over HTTPS (Render does this automatically; on a VPS use Caddy/nginx)
- Restrict CORS to your dashboard domain if you split hosting
- Rate-limit the auth + location endpoints if you expose it publicly

## 🗺️ APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` `/api/auth/login` | account auth (JWT) |
| GET | `/api/devices` | your devices + latest location |
| POST | `/api/devices` | register the device the app runs on |
| POST | `/api/devices/:id/location` | report GPS fix (+ battery) |
| GET | `/api/devices/:id/history` | last 500 location points |
| POST | `/api/devices/:id/ring` | queue a ring command |
| GET | `/api/devices/:id/commands` | device polls & clears pending commands |

## 🧭 Roadmap ideas

- Location history heatmap & "time-machine" slider
- Driver check-in button ("arrived safe") per zone
- Telegram/WhatsApp webhook notifications for zone alerts
- SSO (Google Workspace / Entra) for organization login

---

✅ Implemented so far: consent-based tracking · Teams & roles · MDM-lite
(lock / wipe / locate / audit) · geofence alerts · Docker deployment · EAS builds.

# 🚀 PhoneFinder — Deployment Guide

From zero to a running system your whole organization can use.

---

## Part 1 — Deploy the server (API + dashboard together)

### Option A: Docker (recommended — any VPS: Hetzner, DigitalOcean, Linode…)

```bash
cd phonefinder
cp .env.example .env
# set a strong secret:
openssl rand -hex 32            # paste the result into .env as JWT_SECRET

docker compose up -d --build
```

Done. **Dashboard + API now run at `http://YOUR_SERVER_IP:4000`** (the server
serves the dashboard itself — one URL for everything).

Updates later: `git pull && docker compose up -d --build`
Backups: `docker compose exec phonefinder cp /data/phonefinder.db /data/backup-$(date +%F).db`
(or snapshot the `pfdata` volume).

#### HTTPS with Caddy (2 minutes)

```caddyfile
# /etc/caddy/Caddyfile
phonefinder.yourorg.com {
    reverse_proxy localhost:4000
}
```

Caddy obtains Let's Encrypt certificates automatically. Then set the app's
`API_BASE` to `https://phonefinder.yourorg.com`.

### Option B: GitHub + Render — the "Vercel experience" (recommended for you)

Push to GitHub, connect once, and every future `git push` auto-deploys with
free HTTPS. **Don't use Vercel** — it's serverless with no persistent disk, so
your database would be erased on every restart. Render gives the same workflow
plus a disk for the database.

**1. Push to GitHub** (from the `phonefinder` folder; a `.gitignore` is already
in place — it keeps secrets, the database and node_modules out of the repo):

```powershell
git init
git add .
git commit -m "PhoneFinder v1"
```
Create a **private** repo on github.com named `phonefinder`, then:
```powershell
git remote add origin https://github.com/YOUR_USERNAME/phonefinder.git
git branch -M main
git push -u origin main
```

**2. Create the service on Render** (https://render.com — free account)

- **New → Web Service → connect your GitHub repo** `phonefinder`
- Settings:
  | Field | Value |
  |---|---|
  | Name | `phonefinder` |
  | Region | Frankfurt (closest to Ghana) or Oregon |
  | **Root Directory** | `server` |
  | Runtime | Node |
  | Build Command | `npm install && npm run build` |
  | Start Command | `node server.js` |
  | Plan | Free to try it; **Starter ($7/mo)** for real use (free tier sleeps) |

**3. Give it a persistent disk** (this is your database)

- Service → **Disks → Add Disk** → Mount Path: `/data`, size 1 GB

**4. Environment variables** (Service → Environment)

| Key | Value |
|---|---|
| `JWT_SECRET` | a long random string (generate: `openssl rand -hex 32`, or any password manager) |
| `DB_PATH` | `/data/phonefinder.db` |

**5. Deploy** → in ~2 minutes your system is live at
`https://phonefinder-xxxx.onrender.com` — open it: that's your dashboard. ✅

Later: `git push` = automatic redeploy. Backups: download the disk's file from
Render's dashboard, or add a scheduled `sqlite3 .backup`.

### Option C: Other PaaS

| Platform | Notes |
|---|---|
| **Railway** | Same GitHub flow; add a volume at `/data`, set `JWT_SECRET` + `DB_PATH`. ~$5/mo. |
| **Fly.io** | `fly launch` in `server/`, `fly volumes create pfdata --size 1`, mount at `/data`, set the env vars. |
| **Vercel / Netlify** | ❌ Not suitable — stateless, no persistent database. (Possible only after migrating to Postgres on Neon/Supabase — a rewrite.) |

---

## Part 2 — Build the mobile app into an installable APK

### One-time setup

1. Create a free Expo account: https://expo.dev → then:
   ```bash
   npm install -g eas-cli
   cd phonefinder/app
   eas login
   ```
2. **Point the app at your server** — edit `src/config.ts`:
   ```ts
   export const config = {
     API_BASE: 'https://phonefinder.yourorg.com',  // your deployed server
   };
   ```
3. Link the project to Expo:
   ```bash
   eas build:configure
   ```

### Build the APK (Android)

```bash
npm run build:apk        # = eas build --platform android --profile preview
```

- EAS builds in the cloud (~15 min). When done you get a **download link + QR
  code** — open it on any Android phone and the APK installs. Distribute that
  link to your team (or host the APK on your intranet).
- First build asks you to create/use an Android keystore — **let EAS manage it**
  and keep the credentials safe (you need the same key to update the app).

### Build for iOS

```bash
npm run build:ios
```

Requires an **Apple Developer account ($99/yr)** and a Mac (or EAS cloud) for
signing; distribution via TestFlight or Ad Hoc. For org rollouts, Apple
Business Manager + Custom Apps is the clean path.

### Production / store builds

```bash
npm run build:prod:android   # Android App Bundle (.aab) for Google Play
npm run build:prod:ios       # IPA for App Store / TestFlight
```

### Development without building (testing)

```bash
npm install
npx expo start --lan         # scan the QR with the Expo Go app
```

Fine for demos; for dependable *background* location on real devices, ship the
EAS **preview** build instead.

---

## Part 3 — Roll out to the organization

1. **Compliance first (Ghana, Act 843):** register with the Data Protection
   Commission *before* processing — see the checklist in `README.md`.
2. Admin opens the dashboard → creates an account → creates the organization
   (in the app or via a member account flow) → shares the **invite code**.
3. Each member: install the APK → sign in → join with the code → read & accept
   the disclosure → switch on **Protect this phone** (grant *Always* location).
4. Admin dashboard now shows everyone live — directions, ring, lock, wipe,
   geofence zones & alerts, and the audit trail.

## Ops checklist

- [ ] `JWT_SECRET` set to a long random value
- [ ] HTTPS in front of the server
- [ ] `/data` volume backed up nightly
- [ ] Restrict firewall to your office IP range (optional hardening)
- [ ] Rate-limiting if the server is public (e.g. Caddy's `rate_limit`)
- [ ] Monitor: `curl https://your-server/api/health` → `{"ok":true}`

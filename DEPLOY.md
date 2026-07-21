# 🚀 PhoneFinder — Deployment Guide

From zero to a running system your whole organization can use.
**The whole stack is free:** Render (server, free tier) + Supabase (database,
free tier) + EAS (app builds, free tier).

---

## Part 1 — Create the database on Supabase (5 minutes, free forever)

1. **supabase.com** → sign in with GitHub → **New project**
   - Name: `phonefinder`
   - **Database password: create one and SAVE IT** (you'll paste it once)
   - Region: **West EU (London)** — closest to Ghana
2. Wait ~1–2 minutes for it to provision.
3. Left sidebar → **Project Settings** (⚙️) → **Database** → scroll to
   **Connection string** → **URI** tab → select **Session pooler (port 5432)**
4. Copy the string and replace `[YOUR-DATABASE-PASSWORD]` with your password:
   ```
   postgres://postgres.abcdef:[YOUR-DATABASE-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```

That's it — tables are created automatically the first time the server starts.
Free tier: 500 MB (you'll use a fraction), and it never loses data on deploy.

---

## Part 2 — Deploy the server (API + dashboard together)

### Option A: GitHub + Render — free, auto-deploys on every push ⭐

1. Push to GitHub (`.gitignore` already keeps secrets & node_modules out):
   ```powershell
   git init
   git add .
   git commit -m "PhoneFinder v1"
   ```
   Create a **private** repo `phonefinder` on github.com, then:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/phonefinder.git
   git branch -M main
   git push -u origin main
   ```
2. **render.com** → New → **Web Service** → connect the repo:
   | Field | Value |
   |---|---|
   | **Root Directory** | `server` |
   | Build Command | `npm install && npm run build` |
   | Start Command | `node server.js` |
   | Plan | **Free** — now fine, because the database lives on Supabase |
3. **Environment** variables:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase connection string from Part 1 |
   | `JWT_SECRET` | any long random string |
   | ~~DB_PATH~~ | **delete it if present** (old SQLite setting) |
4. Deploy → logs end with `PhoneFinder server running` → open your
   `https://phonefinder-xxxx.onrender.com` URL. ✅

Notes:
- Free tier sleeps after 15 idle minutes; the first request after sleep takes
  ~30s, and a phone's next 15s location post wakes it. **Data is safe either way.**
- Every `git push` redeploys automatically.

### Option B: Docker on a VPS (most control, ~$5/mo)

```bash
cd phonefinder
cp .env.example .env        # set JWT_SECRET + DATABASE_URL
docker compose up -d --build
```
Dashboard + API at `http://YOUR_SERVER_IP:4000`. Add HTTPS with Caddy:
```caddyfile
phonefinder.yourorg.com {
    reverse_proxy localhost:4000
}
```

### Option C: Other PaaS

- **Railway / Fly.io** — same idea: deploy the `server` folder, set
  `DATABASE_URL` + `JWT_SECRET`.
- **Vercel / Netlify** — ❌ not suitable (they can't run this stateful server).

---

## Part 3 — Build the mobile app into an installable APK

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

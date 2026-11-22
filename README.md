# Ludo Royal

Fair cryptographic-RNG (CSPRNG) 2–4 player Ludo web app with Team Code multi-device multiplayer, per-device Bottom-Left perspective rotation, and an on-board 5-second King vs King knife duel animation with cinema fight sound effects.

Zero npm dependencies — runs directly on Node.js (`>= 18`).

## Free One-Click Cloud Hosting (GitHub -> Render.com)

1. Push or upload this entire folder to a GitHub repository.
2. Go to [Render.com](https://render.com) and sign in with GitHub (no credit card required for the Free plan).
3. Click **New +** -> **Web Service** (or **New +** -> **Blueprint** to auto-read `render.yaml`) and select your GitHub repository.
4. Confirm these settings:
   - **Runtime**: `Node`
   - **Build Command**: *(leave blank)*
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
5. Click **Create Web Service**. Within ~30 seconds you get a permanent free HTTPS link like `https://ludo-royal.onrender.com` that friends can open on any phone or laptop.

> Note: Render's free tier spins down after ~15 minutes of inactivity and wakes up automatically in ~20–30 seconds on the next visit.

## Run Locally on Windows

Double-click `play.bat` or run:

```bash
node server.js
```

Then open `http://localhost:3000`.

# Deploying SocialAmbak for free (demo setup)

Three free pieces: **MySQL** (Aiven) -> **API** (Render) -> **website** (Netlify). Do them in this order.

## 1. MySQL (Aiven free plan, MySQL 8)
1. Create a free MySQL service at aiven.io and wait until it is running.
2. Copy its connection details and build `DATABASE_URL`:
   `mysql://USER:PASSWORD@HOST:PORT/defaultdb?ssl={"rejectUnauthorized":false}`
   (Aiven requires TLS; this form is understood by the mysql2 driver.)

## 2. API on Render
1. Locally run `cd server && npm run gen:keys` and keep the four lines it prints.
2. render.com -> New -> Blueprint -> pick this GitHub repo (it reads `render.yaml`).
3. Fill the values it asks for: `DATABASE_URL`, the four keys, and `CLIENT_ORIGIN` (your Netlify address, set after step 3 - you can edit it later).
4. After deploy, open `https://YOUR-API.onrender.com/api/v1/health`; it must answer `{"data":{"status":"ok"}}`.
   The service sleeps after 15 minutes without visitors; the first request afterwards takes ~50 seconds.

## 3. Website on Netlify
1. Edit `netlify.toml`: replace `YOUR-API.onrender.com` with your Render address, commit and push.
2. app.netlify.com -> Add new site -> Import from GitHub -> this repo. Settings are read from `netlify.toml`.
3. Copy the Netlify address into `CLIENT_ORIGIN` on Render (Environment tab) and let it redeploy.

Why the `/api` forwarding in `netlify.toml`: the sign-in cookie is `SameSite=Strict`, so the browser must see the website and the API as one site.

## Known limits of this free setup
- **Uploads are not permanent.** Photos/videos are stored on Render's disk, which is wiped on every redeploy/restart. Use object storage (S3, Cloudflare R2) for real use.
- **No real email/SMS.** The server runs with `NODE_ENV=development` so sign-up codes appear on screen; production mode refuses this until a provider is wired in.
- **Free-tier sleep** (see above) and shared limits; not for real users' data.
- The `TRUST_PROXY=2` setting tells the API that Netlify and Render sit in front of it, so rate limits count each visitor separately.

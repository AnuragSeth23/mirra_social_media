# SocialAmbak

A photo and video sharing platform. *Share what you see. See what your people share.*

This repository contains phase 1: the full database schema, the brand and design system, and a working, secure
account system (sign up with email + mobile verification, sign in with username / email / phone, sessions,
log out, log out everywhere, dark mode). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap.

## Stack

| Layer | Choice |
| --- | --- |
| Web client | React 18 (JSX), Vite, React Router |
| API | Node.js 20+, Express, plain JavaScript (ES modules), zod |
| Database | MySQL 8.0.16+ / 8.4 LTS (`mysql2` driver, plain SQL migrations) |
| Security | argon2id, AES-256-GCM field encryption, HMAC blind indexes, rotating refresh tokens |

## Project structure

```
socialambak/
├── docker-compose.yml          MySQL 8.4 for local development
├── docs/ARCHITECTURE.md        Architecture, security model, schema notes, roadmap
├── server/
│   ├── migrations/001_init.sql Complete schema for all features
│   ├── scripts/smoke.js        End-to-end auth test (20 checks)
│   └── src/
│       ├── config/env.js       Validated environment config
│       ├── db/                 Connection pool, transactions, migration runner
│       ├── lib/                crypto, password hashing, tokens, phone handling, code delivery
│       ├── middleware/         auth, validation, rate limits, error handler
│       └── modules/
│           ├── auth/           sign-up, verification, sign-in, sessions
│           └── users/          profile
└── web/
    └── src/
        ├── lib/                API client (token refresh), validation, theme
        ├── auth/               session context
        ├── components/         shell, fields, code input
        └── pages/              SignIn, SignUp, Verify, Home
```

## Setup

Requires Node.js 20+ and either Docker or a local MySQL 8.0.16+ (8.4 LTS recommended).

```bash
# 1. Database (wait until `docker compose ps` shows it as healthy)
docker compose up -d db

# 2. API
cd server
npm install
cp .env.example .env
npm run gen:keys            # paste the four printed lines into .env
npm run migrate
npm run dev                 # http://localhost:4000

# 3. Web (new terminal)
cd web
npm install
npm run dev                 # http://localhost:5173
```

Verification codes are printed in the API terminal during development (`[dev-otp] email code for ...`).

To run the end-to-end auth test while the API is running with its output saved to a file:

```bash
cd server
npm run dev &
npm run smoke
```

### Using your own MySQL instead of Docker

```sql
CREATE DATABASE mirra CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'mirra'@'localhost' IDENTIFIED BY 'choose-a-password';
GRANT ALL ON mirra.* TO 'mirra'@'localhost';
```

Then set `DATABASE_URL=mysql://mirra:choose-a-password@localhost:3306/mirra` in `server/.env` and run `npm run migrate`.

## API (phase 1)

All routes are under `/api/v1`. Responses are `{ "data": ... }` or `{ "error": { "code", "message", "details" } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create an account, send email and SMS codes, return a verification ticket |
| GET | `/auth/availability?username=&email=` | Live availability check |
| POST | `/auth/verify` | Submit a code for `email` or `phone`; activates the account when both are done |
| POST | `/auth/resend` | Send a fresh code (60 s cooldown) |
| POST | `/auth/login` | Sign in with username, email or `+`-prefixed phone |
| POST | `/auth/refresh` | Rotate the refresh cookie, get a new access token |
| POST | `/auth/logout` | End this session |
| POST | `/auth/logout-all` | End every session for the account |
| GET | `/users/me` | Signed-in profile (phone masked) |
| GET | `/health` | Liveness and database check |

## What the app does

| Area | Features |
| --- | --- |
| Accounts | Sign up with email + phone codes, sign in with username / email / phone, forgot password (emailed code), change password, deactivate (sign in again to restore), sign out here or everywhere, rotating refresh-token sessions |
| Posting | Photo and video posts, **reels**, 24-hour **stories**, in-browser **camera** (photo and video up to 60 s), edit caption, delete, #hashtags and @mentions, tag pages |
| Engagement | Like, comment with one level of **replies**, save, share link, share counter; post owners can remove comments on their posts |
| Discovery | A brand-new account still sees public posts: "Suggested for you" continues the home feed after the posts from people you follow (never private or blocked accounts) |
| People | Profiles with a post grid and pop-up viewer, follow / follow back / unfollow, **private accounts with approve / decline**, search (people and hashtags), explore grid, suggestions |
| Safety | **Block** (mutual invisibility, follows removed), **report** posts / comments / people, per-account rate limits |
| Inbox | Activity feed with unread badge (likes, comments, replies, follows, requests), 1:1 messages (refresh every 4 s), who-can-message and notification settings |
| Layout | On a computer: left sidebar with every section, feed in the middle, suggestions on the right. On a phone: top bar plus a bottom tab bar. Dark mode, modern violet-blue look |
| Sharing | Share pop-up: copy link (with a visible "Copied"), WhatsApp, Facebook, X, Telegram, email, the phone's own share sheet, or send the post to a friend inside SocialAmbak |
| Polish | Profile card, + create pop-up, back buttons everywhere, modern search with trending hashtags, 404 page, crash screen |

## Run it

```bat
run.bat        :: starts MySQL (3308), the API (4000) and the web app (5173), then opens the browser
```

Or by hand: see **Setup** below. In development a one-time code is shown **on the screen** (a dashed "Development mode" box on the Verify and Forgot-password pages), printed in the API window, and kept in `verification_codes.dev_code`. None of this exists in production.

## Tests

```bat
test-all.bat   :: API checks + browser tests (the app must be running)
```

| Suite | Command | What it covers |
| --- | --- | --- |
| Syntax | `cd server && npm run check` | Parses every server file with Node (no compiler needed): a quick safety net before running |
| API: auth | `cd server && npm run smoke` | 20 checks: sign-up, codes, sessions, token reuse, logout |
| API: features | `npm run smoke:social` | 70 checks: posts, likes, comments, media, reels, stories, follow, search, notifications, saved, messages, reset password |
| API: extended | `npm run smoke:complete` | 71 checks: blocking, reports, replies, hashtags, edit, private requests, settings, password change, deactivate, link safety |
| Browser | `cd e2e && npm test` | 48 Playwright tests in Chrome with a fake camera: every flow above through the real UI, plus phone layout and dark mode |

`npm run test:api` in `server/` runs the three API suites. For tests only, set `DISABLE_RATE_LIMITS=1` in `server/.env` (refused in production) so they can create many accounts. Details and the full case list: [docs/TESTING.md](docs/TESTING.md).

## Known limits (read before going live)

- **Media is not access-controlled.** Photo and video files have long random names and are sent with `Cache-Control: private`, but anyone who has the exact link can open it, even if the account is private. Use signed URLs or private object storage for production. Files nothing refers to are deleted after a day by an hourly job.
- **No real email or SMS yet.** Add providers in `server/src/lib/otp-delivery.js`.
- **Chat is polling, not live.** Socket.IO is the next step; history beyond the latest 100 messages is not paged.
- Share counts are not de-duplicated per person. Hashtag counts include posts from private accounts.
- No admin tool for reports yet: they are stored in the `reports` table.

## Before production

- Add real email and SMS providers in `server/src/lib/otp-delivery.js` (the server refuses `OTP_DELIVERY=console` in production).
- Serve over HTTPS; set `NODE_ENV=production` so cookies are `Secure`; review `trust proxy` in `src/app.js` for your load balancer.
- Store secrets in a secrets manager and enable encrypted storage and backups for MySQL (RDS, Cloud SQL and Azure all offer this).
- Use two MySQL users: one with DDL rights for `npm run migrate`, and a runtime user with only `SELECT, INSERT, UPDATE, DELETE` on the `mirra` schema. Require TLS when the database is on another host.
- Run more than one API instance? Give the rate limiters a Redis store.
- Self-host the two web fonts or add a Content-Security-Policy for Google Fonts on the web host.

# SocialAmbak: the full guide (what, how, why, and the questions you will be asked)

Read this top to bottom once, then use Part 9 (questions) to practise out loud.

---

## 1. What this project is, in one minute

SocialAmbak is an Instagram-style web app. People sign up (email code + phone code), post photos, videos and reels, post 24-hour stories, like, comment, reply, save, follow each other, chat one-to-one, get notifications, block and report. It has a **React** front end, a **Node.js + Express** API, and a **MySQL** database. It also has **161 API checks and 48 browser tests**.

Three programs run together:

```
Browser (React, port 5173)  --/api-->  API (Express, port 4000)  --SQL-->  MySQL (port 3308)
         |                                   |
   Vite dev server                    uploads/ folder (photos and videos)
```

Vite forwards every `/api/...` request to the API, so the browser thinks it is one website. That matters for cookies (see Part 5).

---

## 2. Every technology used, and why it was chosen

### Back end

| Tool | What it does here | Why this and not something else |
| --- | --- | --- |
| **Node.js 20+** | Runs the server | One language (JavaScript) on both front and back end |
| **Express 4** | Web framework: routes, middleware | Small, standard, easy to read and explain |
| **Plain JavaScript (ES modules)** | The language of the whole project, no compile step | What you read is exactly what Node runs. Mistakes are caught by the syntax check (`npm run check`), zod and the tests |
| **MySQL 8.4 + `mysql2`** | Database and its driver | The brief asked for MySQL; `mysql2` supports promises and prepared parameters |
| **Plain SQL, no ORM** | Every query is written by hand in `*.service.js` | You see exactly what runs, easier to explain and tune; an ORM hides it |
| **zod** | Checks every request body (length, format, allowed values) | One place that says what valid input is; gives clear error messages |
| **argon2id** (`@node-rs/argon2`) | Hashes passwords | Current best practice; slow and memory-hungry on purpose so guessing is expensive |
| **jsonwebtoken (JWT)** | Short-lived access token (15 min) | The API can check who you are without a database call for the signature |
| **helmet** | Adds safe HTTP headers | One line of defence against common browser attacks |
| **cors** | Only the web app's address may call the API | Stops other websites using a visitor's browser to call our API |
| **cookie-parser** | Reads the refresh cookie | Needed for the session cookie |
| **express-rate-limit** | Limits how fast one IP or one account can act | Slows password guessing, spam and abuse |
| **libphonenumber-js** | Understands phone numbers | Turns `+91 98765 43210` into one standard form |
| **`node --watch-path=./src`** | Restarts the server when a file in `src` changes | Fast development with no extra tool |

### Front end

| Tool | What it does here | Why |
| --- | --- | --- |
| **React 18** | Builds the screens from components | Most common UI library; state and effects model is easy to reason about |
| **JavaScript (JSX)** | React components in `.jsx` files | Same language as the server |
| **Vite** | Dev server and production build | Very fast start and reload; proxies `/api` to the server |
| **React Router v6** | Pages and links (`/u/:username`, `/post/:id`) | Standard routing |
| **Plain CSS with variables** | Look and feel, dark mode, phone layout | No UI library to learn or ship; colours live in a few variables, dark mode just swaps them |
| **Browser APIs** | `getUserMedia` + `MediaRecorder` (camera), `IntersectionObserver` (reels autoplay), `Clipboard`, `fetch` | No extra packages needed |

### Testing

| Tool | Use |
| --- | --- |
| **Node scripts** (`smoke`, `smoke:social`, `smoke:complete`) | Call the real API and assert on the answers and the database: 161 checks |
| **Playwright** (`@playwright/test`) | Drives real Chrome through the real screens: 48 tests, with a fake camera |
| **An independent review agent** | Read all the code looking for bugs and security holes; its real findings were fixed |

---

## 3. Folder map: what each file is for

```
socialambak/
  run.bat, test-all.bat       one-click start and one-click test
  docker-compose.yml          optional MySQL in Docker
  docs/                       ARCHITECTURE.md, TESTING.md, this guide
  server/
    migrations/001_init.sql   the whole schema (26 tables)
    migrations/002_dev_otp.sql  dev-only column that keeps the plain OTP
    scripts/                  the three API test suites
    src/
      index.js                starts the server, hourly clean-up, clean shutdown
      app.js                  middleware order and which URL goes to which module
      config/env.js           reads and VALIDATES settings; refuses unsafe production settings
      db/pool.js              connection pool + helpers q() / exec() / tx() (transaction)
      db/migrate.js           applies migrations/*.sql once each
      lib/                    crypto, ids (UUIDv7), tokens, passwords, phone, media upload,
                              hashtags, blocks (SQL fragment), OTP delivery, errors
      middleware/             auth (who are you), validate, rate limits, error handler
      modules/
        auth/                 sign-up, verify codes, login, refresh, logout, forgot/reset
        users/                profile, follow/unfollow, requests, search, suggestions
        posts/                posts, feed, reels, explore, saved, tags, likes, comments, media upload
        stories/              24-hour stories, who viewed
        messages/             one-to-one chat
        notifications/        activity feed and unread counts
        safety/               block, unblock, report
        account/              settings, change password, deactivate
  web/src/
    main.jsx, App.jsx         start-up and the route table
    auth/AuthContext.jsx      who is signed in (and sign-out when the session dies)
    lib/api.js                ONE place that talks to the API (adds token, refreshes it)
    components/               PostCard, Composer, CameraCapture, StoryViewer, Topbar, ...
    pages/                    Home, SignIn, SignUp, Verify, Profile, Reels, Chat, Settings, ...
    styles.css                all styling
  e2e/tests/                  the 48 browser tests
```

**Pattern you can explain for any feature:** `*.routes.js` receives the request, checks it with zod, calls `*.service.js`, which runs SQL and returns plain data. Routes never contain SQL; services never touch `req`/`res`.

---

## 4. The database (MySQL), and the choices behind it

**33 tables**, grouped (the full column list is in `docs/FEATURES_AND_DATA.md`):
- **People:** `users`, `user_settings`, `user_privacy`, `sessions`, `verification_codes`, `recovery_requests`, `backup_codes`
- **Graph:** `follows` (status `pending` or `accepted`), `friendships`, `blocks`, `mutes`, `restrictions`
- **Content:** `posts` (kind `post` or `reel`), `post_media` (a reel has several rows, one per photo/video, in `position` order; a photo's `duration_ms`), `hashtags`, `post_hashtags`, `post_mentions`, `post_tags`, `post_likes`, `comments` (with `parent_id` for replies), `comment_likes`, `saved_posts`, `saved_collections`, `stories`, `story_views`, `search_history`
- **Chat and alerts:** `conversations`, `conversation_members`, `messages` (text, a photo/video, or a shared post), `notifications`
- **Safety and logs:** `reports`, `activity_log`, `schema_migrations`
- Tables created but not used by any screen yet: `mutes`, `post_mentions`, `comment_likes`, `saved_collections`, `search_history` (the schema was designed ahead of the features, say this honestly if asked).

Key design decisions:

1. **IDs are UUIDv7 stored as readable text, `CHAR(36)`, and are never encrypted.** An id is an identifier, not a secret, and keeping it readable means you can search it in any database client (`WHERE id = '01a1680e-...'`). v7 starts with a timestamp, so new rows go to the end of the index (fast inserts) and ids are not guessable like 1, 2, 3. They also sort by time (text and bytes sort the same way), which gives us **cursor pagination**: "give me posts with id smaller than X". (They were `BINARY(16)` at first; migration 007 converted all 68 id columns without losing a row.)
2. **Counters are stored on the row** (`like_count`, `comment_count`, `followers_count`...). Reading is instant. They are updated in the **same transaction** as the action, and only when a row really changed (`INSERT IGNORE` / `affectedRows`), so a double click cannot count twice.
3. **Soft delete** (`deleted_at`) for posts, comments and users, so history is not lost and counts can be fixed.
4. **Everything in UTC** (`DATETIME(3)`), the app sets the connection time zone to `+00:00`.
5. **`utf8mb4` and `utf8mb4_0900_ai_ci`:** emoji work, and usernames/emails compare case-insensitively.
6. **Phone numbers and emails are never stored in plain text:** `phone_ciphertext` / `email_ciphertext` (AES-256-GCM, tied to the user id) and `phone_hash` / `email_hash` (HMAC "blind index") so we can find a user by phone or email without being able to read it. Every ciphertext, hash and token hash is stored as lowercase **hex text** (`CHAR`/`VARCHAR`), so a database client shows it like `password_hash` and not as "BLOB". Several accounts may share one phone (up to 5); an email belongs to one account.
7. **Migrations:** plain `.sql` files applied in name order; the table `schema_migrations` remembers which ran. Never edit an applied migration's SQL; add a new file.
8. **Transactions** (`tx()`) wrap anything that changes more than one table (posting, liking, following, blocking, deleting).

---

## 5. How the important flows work (be ready to draw these)

### 5.1 Sign-up and verification
1. Browser sends name, username, email, phone, password, birth date and **where the code should go (`verifyVia`: phone or email)**, like Instagram / Facebook. zod validates (username 3-30 chars, small letters/numbers/`.`/`_`, password 8+ with a letter and a number, age 13+, real calendar date). The username box has no `@`; it drops an `@`, spaces and capitals as you type.
2. Server hashes the password with **argon2id**, encrypts the phone and the email with AES-GCM (plus their blind-index hashes), stores the user as `pending_verification` with `signup_channel` = the choice. A mobile number may be used by up to 5 accounts. **The email is optional** (an account can be phone-only: `email_ciphertext` / `email_hash` stay empty); it is required only when the code is to be sent to the email, and an email that is given must be new.
3. **One** 6-digit code is created, for the chosen channel only. **Only an HMAC of the code is stored**, plus the plain code in `dev_code` in development only (so a developer can read it in the table). In development the code is also printed in the API window; real email/SMS would plug into `lib/otp-delivery.js`.
4. The server returns a **ticket** (a signed token valid 30 minutes) that only says "this browser started sign-up for user X".
5. The user enters that one code (10 minutes, 5 attempts, constant-time comparison). The chosen contact becomes verified, the account becomes `active` and a session starts. The other contact stays saved but unverified. Signing in before verifying re-sends the code to the same channel.
6. A ticket alone can never log someone in (this was a bug the review found and we fixed).

### 5.2 Login and sessions (the most asked topic)
- Login checks the password with argon2 (even for unknown users it does a dummy hash, so timing does not reveal whether the account exists).
- Server returns two things:
  - **Access token**: a JWT valid 15 minutes, kept **only in JavaScript memory** (not localStorage), sent as `Authorization: Bearer ...`.
  - **Refresh token**: a long random string in an **httpOnly, SameSite=Strict cookie** (JavaScript cannot read it). The database stores only its **SHA-256 hash**.
- When the access token expires, `api.js` silently calls `/auth/refresh`. The server **rotates** the refresh token (old one is revoked, new one issued).
- **Reuse detection:** if an old, already-used refresh token appears again, we assume it was stolen and revoke the whole chain (`family_id`). A 15-second grace avoids false alarms when two tabs refresh at once.
- Every request also checks that the session row is not revoked, so "log out everywhere" and password changes take effect immediately.
- **CSRF:** refresh/logout need a custom header (`X-SocialAmbak-Client`). A website on another origin cannot add that header without our CORS permission, and the cookie is SameSite=Strict.

### 5.3 A post, from click to screen
Composer pop-up -> file is read -> `uploadMedia()` sends the **raw bytes** to `POST /media` -> server decides the type from the file's **first bytes (magic numbers)**, not the file name -> saves it under a random UUID name in `uploads/` -> returns the key -> browser sends `POST /posts {caption, mediaKey, kind}` -> transaction inserts `posts`, `post_media`, `users.posts_count + 1`, and hashtags -> feed shows it.
Photos max 5 MB, videos max 50 MB (two separate size limits so an image can never make the server buffer 50 MB).

### 5.4 The feed query and "who can see what"
One SQL fragment (`VISIBLE`) is used by every post query. A post is visible if: it is not deleted, its author is active, **nobody blocked anybody**, and the author is public, or it is me, or I follow them with status `accepted`. Because every list (feed, profile, reels, explore, saved, tag page, single post, comments, likes) goes through it, privacy is enforced in one place.

### 5.4b "Suggested for you" (new users)
`GET /posts/discover` returns newest **public** posts from people I do not follow (not me, no private accounts, nobody blocked, same shared visibility rule). The home screen loads it automatically once the posts from followed people end, so a brand-new account never sees an empty page. Following someone moves their posts to the main feed and out of the suggestions.

### 5.4c The screen layout (like Facebook and Instagram on the web)
On a computer (1024 px and wider) the navigation is a fixed **left sidebar** (Home, Search, Create, Reels, Activity, Messages, Profile, Settings, your name and Log out). The feed is in the middle. From 1100 px a **right-hand rail** holds your name and "People to follow". On narrower screens the rail disappears and the same suggestions become a swipeable strip inside the feed; on a phone the sidebar becomes a top bar plus a **bottom tab bar**. It is one set of components and CSS media queries, no separate mobile app. The Home page decides where the suggestions live with a small hook (`useWide(1100)`).

### 5.4d Share
The Share button opens a pop-up (`ShareDialog`): a copy-link button that visibly turns into "Copied", links that open WhatsApp, Facebook, X, Telegram or your email program with the post link filled in, the phone's own share sheet on touch devices, and "send to a friend", which sends the post itself as a **card** in the chat (`messages.shared_post_id`): a preview with the picture, the author and the caption, opening the post when tapped. The card is built for whoever is reading: if they may not see the post (it became private, was deleted, or they are blocked) they get "This post is no longer available" and nothing about it. You can only share a post you can see. The share counter goes up once per pop-up, the first time something is really shared.

### 5.5 Follow, private accounts, requests
Following a public account is `accepted` at once. Following a private account creates `pending` plus a notification; the owner accepts or declines in Activity. Accepting moves both counters in the same transaction. If the account turns public, waiting requests are accepted automatically.

### 5.6 Block
Blocking inserts into `blocks`, removes follows in both directions (and fixes counters). After that each person looks like a non-existent account to the other: not in search, suggestions, comments, stories or chat; they cannot follow, like or message. The blocker still sees the profile so they can unblock.

### 5.7 Stories, reels, camera
- **Story:** a row with `expires_at = now + 24h`; the tray query shows only live stories of me and people I follow. Viewing is recorded once per viewer.
- **Reel:** a post with `kind = 'reel'` and **1 to 10 photos and/or videos**, played one after another (`post_media` rows in `position` order). A photo shows for 5 seconds unless the author changes it with − / + (1 to 30 s, stored in `duration_ms`); a video plays for its own length. In the composer the files can be reordered and removed. The Reels page uses scroll-snap and an `IntersectionObserver` so only the reel on screen plays (and it restarts from its first item when it comes back), shows one progress bar per item, and a tap pauses. The reel frame takes the shape of the first photo/video (never cropped), the like / comment / share / save buttons sit on a dark pad so they stay visible over a white photo, and there is a back button on the reel. Only the author's name shows under the picture, not the caption.
- **Camera:** `getUserMedia` opens the camera, a canvas takes a still photo, `MediaRecorder` records video (WebM in Chrome, MP4 in Safari) up to 60 s. If you close the camera while recording, the clip is discarded.

### 5.8 Chat
Each pair gets one conversation (unique `dm_key` = the two ids sorted). A message is text, a **photo or video** (uploaded first, then sent by key), or a **shared post/reel card**. The page asks for new messages every 4 seconds (**polling**), and pauses when the tab is hidden. A real-time version would use WebSockets (Socket.IO).
**Message requests (why a second message can wait):** if the person is not your friend, your first message lands in their *Requests* folder and you may send only that one until they accept (or reply). The chat then closes the composer and says "Message request sent... you can send more once they do" instead of showing an error (`canSend` in the thread answer). The chat has its own back button.

### 5.9 Notifications
Created in the same transaction as the action (like, comment, reply, follow, request, accepted). Never for your own actions, never across a block, and they respect your notification settings. The red badge polls every 30 s.

### 5.10 Forgot password and forgot username (one flow)
1. **Find your account:** type a username, an email or a mobile number. For a username you choose whether the code goes to its email or its phone; an email or phone already says where.
2. **Code:** a 6-digit code (10 minutes, 5 tries, at most 5 codes per contact per hour, one per minute). The request belongs to the **contact** (`recovery_requests`), not to one account. The answer is always the same, so nobody can discover which accounts exist: an unknown identifier gets a request nobody can complete, with the same try-limits.
3. **Accounts:** a correct code proves the email/phone and lists **every account that uses it** (a number can be shared by up to 5): sign in as one (the username is remembered and suggested on the sign-in page), or reset its password. Suspended accounts are not listed.
4. **Reset:** within 15 minutes of the code, pick an account and set a new password; that account's **sessions are all revoked**.
Signing in with a shared phone number works too: the password says which account is meant (if two accounts share number and password you are asked to use the username).

---

## 6. Security checklist (you should be able to list these)

| Risk | What we did |
| --- | --- |
| Password theft | argon2id hashes; generic "details don't match" message; per-account lockout (10 failures / 15 min) |
| Phone number leak | AES-256-GCM encryption bound to the user id; HMAC blind index for lookup; API only returns a masked number |
| Stolen database | Refresh tokens and OTPs are stored hashed; only `dev_code` (development only) keeps a plain code |
| XSS | React escapes text; no `dangerouslySetInnerHTML`; profile website must be `http(s)` only (a `javascript:` link was a real finding); access token not in localStorage |
| CSRF | SameSite=Strict cookie + required custom header + locked CORS |
| SQL injection | Every value goes through `?` placeholders; table/column names are never user input; LIKE wildcards are stripped |
| Upload attacks | Type decided by magic bytes, random server-made file names (no path tricks), only jpg/png/gif/webp/mp4/webm (no SVG/HTML), size limits per type |
| Brute force and spam | IP limits on login/sign-up/codes; per-account limits on uploads, posts, comments, messages, follows, reports |
| Account enumeration | Forgot/reset answer the same for real and unknown accounts; reset checks the code before saying anything about the account |
| Session theft | Rotation + reuse detection; revoke on logout-everywhere, password change, reset, deactivate |
| Bad configuration | `config/env.js` refuses to start in production with console OTP or rate limits switched off, and checks keys are 64 hex and all different |
| Privacy | One shared visibility rule; private accounts; blocks; deleted and deactivated accounts disappear |

---

## 7. Testing: what exists and how to explain it

- **API suites** (`npm run test:api`): `smoke` 20 + `smoke:social` 70 + `smoke:complete` 71 = **161 checks**. They create real users through the API, read OTPs from `verification_codes.dev_code`, and assert on status codes, counters and database rows (for example "following twice counts once", "a ticket cannot log in", "`javascript:` link rejected").
- **Browser suite** (`e2e`, Playwright): **48 tests** in real Chrome with a fake camera: sign-up with codes, login by username/email/phone, forgot password, posting, editing, replies, hashtags, camera photo and video, stories, follow and private requests, block, report, chat between two browsers, settings, phone layout, dark mode.
- **Independent review:** a second agent read all code with fresh eyes; confirmed bugs were fixed (list in Part 8).
- **Not covered (say it yourself before they ask):** real email/SMS, rate limits (switched off in tests), screen readers, browsers other than Chrome, load testing.
- QA angle: you can say tests are layered like a pyramid: many fast API checks, fewer slow UI tests; UI tests use API calls to create test data quickly (`createUser`) and only the flow under test goes through the screen.

---

## 8. Bugs found while building (great stories to tell)

1. Camera shutter did nothing if pressed before the video was ready -> button disabled until ready.
2. React dev mode mounts components twice, which made a "discard recording" flag permanent -> reset the flag on every mount.
3. Share opened the Windows share sheet on desktop -> copy link on computers, share sheet only on phones.
4. Mobile bottom bar jumped to the top: `backdrop-filter` makes a parent the reference for `position: fixed` children.
5. Test phone-number generator produced only ~1000 distinct numbers and began colliding.
6. From the review: **`javascript:` website link (stored XSS)**, **sign-up ticket usable as login**, **password-reset leaked whether an account exists**, **private accounts could never accept followers**, unlike failing once a counter hit 0 (unsigned column), a crash when a post had over 500 comments, impossible birth dates (31 Feb) crashing sign-up, comment reply bypassing a block.

---

## 9. Questions you can be asked, with answers

### A. Basics and "tell me about it"
**Q1. Explain your project.**
A social app like Instagram: accounts with email and phone verification, posts with photos and videos, reels, stories, likes, comments with replies, follow and private accounts, chat, notifications, block and report. React front end, Express API, MySQL database. It is tested with 161 API checks and 48 browser tests.

**Q2. Why this stack?**
One language end to end (JavaScript), very common tools (React, Express, MySQL), and few dependencies so I can explain each line: no ORM, no UI library.

**Q2b. Is it Node.js or JavaScript? What is the difference?**
Both. JavaScript is the **language**; Node.js is the **runtime** that runs JavaScript on a server (outside a browser). The server is written in JavaScript and executed by Node.js; the React front end is also JavaScript (JSX files) and is run by the browser, with Vite bundling it. There is no compile step on the server: `node src/index.js` runs the code exactly as written.

**Q2c. Why plain JavaScript and not TypeScript?**
The project was first written in TypeScript and then converted on request to plain JavaScript so the whole stack is Node.js and JavaScript. We lose compile-time type checks, so safety comes from zod (runtime input checks), `npm run check` (parses every file), and the 161 API checks plus 48 browser tests. A typed copy of the earlier version is kept as a backup folder.

**Q2d. Why does the sign-up form take only 10 digits?**
Because the product rule is a 10-digit mobile number. The Country box (India +91 selected by default) holds the country code, so the number box holds only digits. The form drops letters, spaces, a pasted "+91" and a leading 0, and stops at 10. The server enforces the same rule again (and for India requires a number starting with 6 to 9), because the browser can always be bypassed.

**Q3. Who built it? Did you use AI?** *(answer honestly)*
I built it with an AI coding assistant (Claude Code) guiding the work, and I reviewed and tested it. I then studied every part so I can explain the design and change it. Being clear about this is better than pretending, because follow-up questions will show it either way. Then show you understand: pick any flow from Part 5 and explain it.

**Q4. What was the hardest part?**
Keeping privacy rules correct everywhere (blocks, private accounts, deleted users), and sessions (refresh rotation and reuse detection). I solved the first with one shared SQL visibility fragment and tests; the second with hashed rotating refresh tokens in families.

### B. Front end
**Q5. How does the front end talk to the back end?**
Only through `lib/api.js`. It adds the access token, and if the server says 401 it refreshes the token once and retries; if refresh fails it signs the user out.

**Q6. Why is the access token in memory and not localStorage?**
Any XSS bug could read localStorage. Memory disappears on reload, so we get a new one from the httpOnly refresh cookie, which JavaScript cannot read.

**Q7. How does dark mode work?**
CSS variables for colours; `[data-theme='dark']` or the system preference swaps them. A tiny script in `index.html` sets the theme before React loads to avoid a white flash.

**Q8. How are optimistic updates done?**
Like: the number changes immediately, then the server's numbers replace it; on error we roll back. Handlers read the latest post from a `ref`, so a slow answer cannot overwrite newer changes.

**Q9. How does the camera work?**
`getUserMedia` for the stream, canvas for photos, `MediaRecorder` for video, then the result becomes a `File` and goes through the same upload path as a picked file. We try audio+video first and fall back to video only; we stop the old stream before switching cameras.

**Q10. How do reels know which video to play?**
`IntersectionObserver` plays the video that is at least 65% visible and pauses the rest. Videos start muted because browsers only autoplay muted video.

**Q11. State management?**
No Redux. Local `useState` per screen, one `AuthContext` for the signed-in user. The app is small enough that this is clearer.

**Q12. How is the app responsive?**
CSS only: grid and flex, one breakpoint near 760 px. On phones the top navigation becomes a fixed bottom tab bar.

**Q13. Accessibility?**
Buttons have names (`aria-label`), dialogs use `role="dialog"`, errors use `role="alert"`, keyboard works (Esc closes pop-ups). A full screen-reader test is not done yet.

### C. Back end
**Q14. Why Express and not NestJS?**
Express is simpler and explicit; the project has a clean module pattern (routes -> service -> SQL) so the structure is visible without a framework.

**Q15. Why no ORM?**
Hand-written SQL shows exactly what runs, and some queries (visibility with blocks, counters) are easier to control. The cost: more care with placeholders, which the tests cover.

**Q16. How do you validate input?**
zod schemas in the route file; failures return 422 with the field name and message so the form can show it under the right box.

**Q17. How do you handle errors?**
Services throw `AppError(status, code, message)`; one error handler turns it into JSON. Unknown errors are logged on the server and the client only sees a generic message (no stack traces leak).

**Q18. How does pagination work?**
Cursor-based: the client sends the id of the last post it has; the server returns older ones (`id < cursor`) and the next cursor. Because ids are UUIDv7 (time-ordered) this is stable even when new posts arrive, unlike page numbers.

**Q19. What is a transaction and where do you use it?**
All-or-nothing group of SQL statements. Used wherever more than one table changes: creating a post (post + media + counter + tags), like (row + counter + notification), follow, block, delete.

**Q20. How do you avoid double-counting a like?**
`INSERT IGNORE` into `post_likes` (primary key post+user). The counter changes only if `affectedRows` is 1. Unlike works the same with DELETE.

**Q21. What happens if two people open the same chat at once?**
A unique `dm_key` makes the second insert fail; the code catches that error and uses the conversation the first one created.

**Q22. How do uploads stay safe?**
Random file names, type from magic bytes, allow-list of types, separate size limits, no executable or SVG, served by `express.static` with `nosniff` and a private cache header, orphans deleted after a day.

**Q23. Rate limiting?**
IP limits for login, sign-up and codes; per-account limits for uploads, posts, comments, messages, follows, reports. In-memory today, so with several servers you would move them to Redis.

### D. Database
**Q24. Why UUIDv7 and `BINARY(16)`?**
Time-ordered (fast inserts, easy cursor paging), hard to guess, and 16 bytes instead of 36 characters, so indexes are smaller.

**Q25. Why store counters on the row instead of `COUNT(*)`?**
Reading a feed needs counts for 10 posts at once; `COUNT(*)` on millions of likes is slow. The price is keeping them correct, which is why updates happen in transactions and are tested.

**Q26. Which indexes matter?**
Examples: `posts (author_id, deleted_at, created_at)` for a profile, `follows (followee_id, status, created_at)` for followers, `comments (post_id, parent_id, created_at)` for threads, `notifications (recipient_id, created_at)` for the inbox.

**Q27. How do you change the schema later?**
Add a new numbered migration file; never edit one already applied. For big tables on a live system: add the column nullable first, backfill, then add constraints.

**Q28. How do you search for a user by phone if it is encrypted?**
With a **blind index**: an HMAC of the normalised number is stored next to the ciphertext. The same input always gives the same HMAC, so we can match it without being able to read the number.

### E. Security
**Q29. How do you store passwords?**
argon2id hashes, never the password. Even I cannot read anyone's password; if someone forgets it, they reset it.

**Q30. Explain access and refresh tokens.**
See 5.2: short-lived JWT in memory, long-lived random token in an httpOnly cookie stored hashed, rotated on use, reuse revokes the chain.

**Q31. What is CSRF and how do you stop it?**
An attacker site making the victim's browser send a request with their cookies. We use SameSite=Strict cookies, a required custom header on cookie-authenticated endpoints, and CORS locked to our own origin.

**Q32. What is XSS and what did you do?**
Injecting script into a page. React escapes output, no raw HTML, link URLs are checked (`http`/`https` only), tokens are not in localStorage, helmet sets a Content-Security-Policy.

**Q33. What is SQL injection and how is it prevented?**
User text becoming SQL. All values use `?` placeholders; names of tables/columns come only from code.

**Q34. What security bug did you find in your own project?**
Pick one: the `javascript:` website link (stored XSS, could steal a session), or the sign-up ticket that acted like a password-free login. Explain the scenario and the one-line fix.

**Q35. How do you prevent account enumeration?**
Login and forgot-password answer the same for real and unknown accounts, and login does a dummy hash for unknown users so the response time is the same.

**Q36. Is the media private?** *(honest answer)*
Not fully. Files have long random names and a private cache header, but anyone with the exact link can open it, even for private accounts. For production I would use signed, expiring URLs or private object storage (S3 + CloudFront signed URLs).

### F. Testing and QA (your strength)
**Q37. How did you test it?**
Three layers: 161 API checks, 48 Playwright browser tests, and an independent code review. API checks assert both the response and the database effect (counters, rows). Browser tests cover real user flows including two browsers talking to each other.

**Q38. How do the tests get the OTP?**
In development the plain code is also saved in `verification_codes.dev_code`; production never fills it. Tests read it from the table.

**Q39. How do you keep tests independent?**
Each test creates its own users with random names and phone numbers; no test relies on another's data.

**Q40. What did testing actually find?**
The camera shutter race, the dev-mode double-mount bug, desktop share behaviour, the mobile nav bug, and in review the XSS link and the ticket-as-login. (Part 8.)

**Q41. What is not tested?**
Real email/SMS, rate limits (disabled for tests), screen readers, other browsers, load/performance.

**Q42. How do you debug a failing UI test?**
Playwright keeps a screenshot, a trace and an error context for failures; I read the call log (for example "element is not enabled") and decide if the product or the test is wrong. Two of my failures were real product bugs, three were test selectors.

### G. Design, scale, improvements
**Q43. How would you make chat real-time?**
Attach Socket.IO to the same HTTP server, authenticate the socket with the access token, push new messages and typing events; use Redis adapter when running several servers.

**Q44. How would it scale to a million users?**
Stateless API behind a load balancer; Redis for rate limits and sessions cache; read replicas for the database; media on object storage + CDN; background workers (queue) for notifications and cleanup; precomputed or cached feeds instead of live "followees" queries.

**Q45. What would you improve first?**
1) Signed media URLs, 2) real email/SMS providers, 3) WebSocket chat, 4) an admin screen for reports, 5) share-count de-duplication, 6) paging for old chat history.

**Q46. Why polling instead of WebSockets for now?**
Simpler and enough for a first version; it keeps the server stateless. Known trade-off: up to 4 seconds delay and extra requests.

**Q47. Why did you put the post box in a pop-up?**
It keeps Home clean (stories, then feed). The + button opens it in the right mode (story or post), and it closes by itself after a successful share.

**Q48. Biggest trade-offs you made?**
No ORM and no state library (clarity over convenience); denormalised counters (speed over simplicity); polling (simplicity over real time); public media links (simplicity over privacy, documented).

### H. Short "gotcha" questions
- *JWT or session?* Both: JWT for the short access token, a database-backed session for revocation.
- *Why 15 minutes?* Short enough that a stolen token dies quickly, long enough to avoid constant refreshes.
- *Why hash a refresh token if it is random?* If the database leaks, the hashes cannot be used as tokens.
- *What does `SameSite=Strict` do?* The cookie is only sent for requests that start on our own site.
- *HTTP 401 vs 403 vs 404 vs 422 vs 429?* 401 not signed in, 403 signed in but not allowed, 404 not found (also used to hide existence), 422 invalid input, 429 too many requests.
- *Why return 404 for a conversation you are not part of instead of 403?* So nobody can learn which ids exist.
- *What is idempotent?* Doing it twice has the same effect as once (like, follow, save). Our endpoints are built that way.

---

## 10. How to present it (practical advice)

1. Start with the three-box picture in Part 1, then follow **one** action end to end (for example "like a post": button -> `api()` -> route -> `setLike` -> SQL transaction -> counter -> notification -> screen).
2. Say the trade-offs and limits yourself (Part 7 and 9-E36). It makes you sound trustworthy, and examiners usually ask about them anyway.
3. Be ready to open `posts.service.js` and explain `VISIBLE`, `setLike` and `feed`; `auth.service.js` and explain `refreshSession`; `api.js` and explain the 401 retry.
4. Run `run.bat`, then two browsers with two demo accounts: follow, chat, block. A live demo beats slides.
5. If you do not know something, say how you would find out (read the code, the test, the SQL). That is what a developer does.

## 11. Commands you may be asked to run

```bat
run.bat                          :: start database, API (4000), web (5173)
cd server && npm run test:api    :: 161 API checks
cd e2e && npm test               :: 48 browser tests (WEB_URL=http://localhost:5174 if vite is on 5174)
cd server && npm run check       :: parses every server file (syntax safety net, no run)
cd server && npm run migrate     :: apply new SQL migrations
```

Demo accounts (password `Social@2026`): `riya.demo`, `arjun.demo`, `sana.demo`, `kabir.demo`, `meera.demo`.

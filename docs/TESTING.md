# Testing SocialAmbak

Three layers, all automated. Start the app first (`run.bat`), then `test-all.bat`.

| Layer | Where | Count | Needs |
| --- | --- | --- | --- |
| API: auth | `server/scripts/smoke.js` | 20 | API + database |
| API: features | `server/scripts/social-smoke.js` | 70 | API + database |
| API: extended | `server/scripts/complete-smoke.js` | 71 | API + database |
| Browser (Playwright, Chrome) | `e2e/tests/*.spec.js` | 48 | API + web + Google Chrome |

The API suites read one-time codes from `verification_codes.dev_code` (filled in development only). The browser suite uses a fake camera and microphone, so it runs without hardware. Run the browser suite against another address with `WEB_URL=http://localhost:5174`.

For tests, put `DISABLE_RATE_LIMITS=1` in `server/.env`. The app refuses to start in production with it.

## Case list

**Sign-up and sign-in**: empty and invalid form errors · valid sign-up with email then phone code · wrong code counted (attempts left) · sign-in by username, email and phone · wrong password and unknown account give the same message · forgot password with code and new password · old password stops working · reset code single-use · unknown account and real account answer the same on reset · back buttons · protected pages redirect to sign-in · 404 page · impossible birth date (31 Feb) rejected.

**Sessions and security**: refresh cookie httpOnly and strict · refresh rotation · replayed refresh token revokes the family · logout and logout-everywhere · a finished sign-up ticket cannot mint a session · password change keeps this device and signs out others · `javascript:`, `data:`, `ftp:` profile links rejected · fake image and video bytes rejected · media type decided from file bytes.

**Posts**: text, photo, video and reel posts · empty post blocked · wrong type and over-size file blocked · edit caption (tags follow) · delete (counts and tags fixed) · like is idempotent and never negative · save and unsave · share copies a link · comments, replies (one level), delete by author or post owner, counts correct · hashtags and mentions are links · tag page · cursor paging ("Load more") · explore · saved list · reels feed · video served with Range support.

**People**: profile pop-up card · post grid and pop-up viewer · follow, follow back, unfollow · counters correct and idempotent · private account request, accept, decline, and auto-accept when the account goes public · pending requester cannot see posts · search by name and hashtag · suggestions put people who follow you first.

**Safety**: block removes follows both ways and fixes counters · blocked person sees "not found" · blocked people hidden from each other's search and suggestions · cannot open posts, like, follow or start a chat across a block · unblock restores visibility · report post, comment or person (stored once, own content refused, bad reason refused).

**Discovery**: a new user with no follows sees public posts as "Suggested for you" · private accounts, blocked people and own posts never suggested · following moves a post to the main feed · cursor paging with no repeats · needs sign-in.

**Sign-up phone and side panel**: India (+91) preselected · no country code inside the number box · digits only, stops at 10 · pasted "+91 98765 43210" and "09876543210" are cleaned · India must start with 6-9 · the server refuses more than 10 digits and Indian numbers not starting 6-9 · the sign-in panel explains the app.

**Layout, share, icons, search**: sidebar on the left with visible labels · suggestions in a right-hand rail on wide screens, a strip inside the feed on narrow ones · Share pop-up copies the link with a visible answer, lists WhatsApp/Facebook/X/Telegram/email, counts the share once, and can send the post to a friend (a clickable link in the chat) · Share, Messages and Comment icons are different pictures · search shows trending hashtag chips, people and hashtag cards, a clear button, and trending never counts private accounts.

**Stories, camera, media**: story create, view (counted once), delete, visible to followers only · camera photo and video · recording discarded when the camera is closed · shutter disabled until the camera is ready · avatar upload.

**Inbox**: like, comment, reply, follow, request and accepted notifications · notification settings respected · unread badge and mark-as-read up to what was shown · chat opens one conversation per pair (both directions) · unread counts · "who can message me" respected · closed-messages reason shown.

**Settings and account**: edit profile, avatar, website, private switch · messaging and notification preferences persist · change password (current password required) · deactivate hides the account and sign-in restores it.

**Layout and accessibility basics**: phone layout with bottom tab bar and no sideways scroll · profile card fits a phone · navigation items have names · dark-mode toggle · country list readable in dark mode.

## Not covered by automation

Per-account rate limits (switched off for tests) · block rules for comment lists and stories (implemented in the queries, not asserted) · Real email and SMS delivery (not built) · access control of media files by account privacy (known limit) · long-running chat history · a screen-reader pass · browsers other than Chrome.

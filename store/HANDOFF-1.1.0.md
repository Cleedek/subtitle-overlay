# Handoff: Subtitle Overlay 1.1.0, release today (2026-11-12)

Goal: Filip uploads 1.1.0 to the Chrome Web Store **today** and sends it to review. Your job is to get everything ready so that he only has to click through the Dashboard. Talk to Filip in Czech (informal "ty"), plain language, he is a designer, not a coder. Never use em dashes or curly quotes. End every reply with "Confidence: X/10".

Read first: `store/LISTING.md`, section **"Postup pro 1.1.0"** (full plan, card texts, privacy bullets, risks). This handoff is the to-do list on top of it.

## Where things stand (updated 2026-11-12 08:00)

- Repo `~/subtitle-overlay` (public GitHub Cleedek/subtitle-overlay, GPL). `main` at `49b8885`, **committed and pushed** (includes 1.0.20 `c1eff8a` and three commits from 07:56-07:57, see below). Working tree was clean at 08:00. Manifest still says 1.0.20; `lib/whats-new.js` still has only the 1.0.19 entry.
- In the store: 1.0.19 (or 1.0.20 if Filip already sent it; **ask him first**, a new package can only be uploaded after the previous review is done or cancelled).
- Two finished features are switched off in `lib/settings.js`: `SHARING = false` (line ~368) and `REUSE_SAVED = false` (line ~373). Both were tested in two real Chrome profiles against a local server. 1.1.0 = switch both on.
- The store description and the 1.0.19 What's new card ALREADY promise saved-copy reuse ("comes back on any other page with the same subtitles"), which is off right now. 1.1.0 makes that true.
- Sharing server `~/subtitle-share` (Cloudflare Worker + D1, route subs.cleedek.com): **not deployed**. `DEPLOY.md` has the 4 steps, `npm test` passes 6/6. The `database_id` in `wrangler.jsonc` is still "TODO".
- Already committed since 1.0.20 and going into 1.1.0 (other sessions did it; still check `git status` before you start, other sessions often edit these files):
  - `15170dc`: **Improve** also for YouTube automatic captions in your own language (content.js `cleanable`/`startClean`, `CLEAN_PROMPT` in background.js); **translation queue progress shown in the card over the video**, the finished queue file replaces Google's lines (content.js `queueJobFor`/`queueRow`); YouTube CC button and our subtitles stay in step, also while loading; Alt + = / Alt + − bigger/smaller, key labels follow the real keyboard layout; **`RECENT_SITES = true`** (goodbye page lists the last 3 video sites); new strings in all 30 locales.
  - `49b8885`: welcome page after install (`welcome.html/.css/.js`, `welcome/demo.mp4`, `welcome/demo.jpg`), opened from `background.js` onInstalled (new installs only).
  - `b64a76d`: `store/privacy-policy.html` updated for recent sites + the goodbye page's "My language was missing" answer, date November 12; first sentence now "stores on a server only what you choose to send"; LISTING.md "Postup pro 1.1.0".
- **Live privacy page is already updated** (cleedek-portfolio `3d9287d`, deployed and pushed `9ff1e1a`): recent sites + missing-language text, date 12. 11. It does **not** describe shared subtitles yet. Note: lookup of shared subtitles is on by default, so "only what you choose to send" is not accurate once sharing ships; the sharing bullets must go in.
- Feedback Worker `~/extension-feedback` (feedback.cleedek.com): deployed 2026-11-12 with recent sites, report-a-problem and missing-language parts; committed `2d3e2d5` locally (no remote). Known gap, not blocking 1.1.0: "Released, notify" emails for missing languages fail until Filip sets up Cloudflare Email Sending for cleedek.com.

## Decisions to get from Filip at the start (one short message, buttons if possible)

1. Is 1.0.20 already sent / approved?
2. Everything listed above is already committed, so it ships unless he wants something pulled out. Only confirm; recent sites (`RECENT_SITES = true`) was tested in Chrome by the other session and its privacy text is live.
3. OK to deploy subs.cleedek.com now? (Required before review; never deploy without his yes.)
4. What's new card: approve the 9 points in LISTING.md "Karta Co je nového pro 1.1.0" or change them. New candidate since the list was written: "**Translation queue** progress now shows in the card over the video, and the finished file replaces Google's lines on its own" (could replace point 8, the size shortcuts). His rule: Claude proposes CS+EN, he approves, then all languages.
5. "Find subtitles from others" stays **on by default** (his decision from 11. 11.) knowing the store-review risk in LISTING.md? Default: yes, keep on, disclose clearly.
6. Screenshot 2 swap (shared row instead of "Improving 46 %"): recommended **skip today** (32 languages to re-render); can come later without a new version.

## To do, in order

1. **Code freeze check:** make sure no other session is still writing in `~/subtitle-overlay` (`git status`, mtimes, ask Filip). Read `git diff c1eff8a..HEAD` once (skip locales) so you know what ships.
2. **Flip the switches:** `SHARING = true`, `REUSE_SAVED = true`. `manifest.json` version `1.1.0`. Check the popup sharing switches (`#shareSetting`) become visible and that nothing else is gated by these flags in a way that breaks (grep `SHARING`, `REUSE_SAVED` in all .js).
3. **What's new card** (`lib/whats-new.js`): one entry `version: '1.1.0'`, `heading: 'in recent versions'` (already translated), the approved items (new ones first, then the 1.0.17 to 1.0.19 recap); **delete the 1.0.19 entry** so 1.0.18 users don't see points twice. Add the new item strings to all 30 `lib/locales/*.json` (append as text, don't re-serialize: plural objects are inline). Bold `**labels**` must match the real interface label in each language.
4. **Tests** (real Chrome, recipes in the memory notes and scratchpad-style scripts):
   - extension loads with no errors in the service worker and popup,
   - sharing end to end against the **live** server after deploy: profile A improves and shares, profile B finds it; "Delete my shared subtitles" works; report hides after 3,
   - saved-copy reuse on a second page with the same subtitles,
   - What's new card: simulate update from 1.0.18 and from 1.0.20 (`whatsNewFrom` in storage), 3 pages, no duplicates,
   - welcome page opens on a fresh install only,
   - layout check of popup + batch page in all 32 UI languages (earlier scratchpad `layoutcheck.mjs` pattern: wraps, clipped text).
   Delete any test rows from the live D1 afterwards.
5. **Server deploy** (after Filip's yes): steps in `~/subtitle-share/DEPLOY.md`, then the `curl` check. Consider adding a way to delete a copy by id from the admin side (copyright takedown); at minimum know the `wrangler d1 execute` command for it.
6. **Commit** in logical pieces on main (Co-Authored-By line as the system says). Push to GitHub only with Filip's yes (the repo is public; earlier commits are already pushed).
7. **Zip:** `dist/subtitle-overlay-1.1.0.zip` via `git archive` of the runtime files (same file list as 1.0.20 + `welcome.html`, `welcome.css`, `welcome.js` and `welcome/`; no mockups, store, promo-video, tests). Unzip it into a fresh folder and load THAT in Chrome once to be sure.
8. **Store description**, all 32 `store/descriptions/*.txt` at once (else "Mismatching metadata"): changes listed in LISTING.md (NEW highlight line for shared subtitles, new SHARED SUBTITLES section, Improve for YouTube auto captions, queue progress over the video in the TRANSLATION QUEUE section, shortcuts Alt + = / −, sharing sentence in PRIVACY). Write EN + CS first, show Filip, then the other 30. Keep under the store's character limit; Netflix stays out of store texts.
9. **Privacy policy:** `store/privacy-policy.html` AND `~/cleedek-portfolio/src/pages/[...lang]/subtitle-overlay/privacy.astro` (EN + CS, same meaning). Recent sites and missing language are already in both and live; add only the **shared subtitles** part. Bullets are drafted in LISTING.md (lookup = first 5 characters of the fingerprint + language, on by default; sharing only after consent with what is sent; reports; IP only for rate limiting, verified not stored; takedown contact; new storage keys). Adjust the first sentence: since the lookup runs by default, "stores on a server only what you choose to send" stays true for storing, but say that a lookup sends a short fingerprint. Keep the date at the day it goes to review.
10. **Website changelog:** skill `project-changelog` for the 1.1.0 entry (EN + CS), dated the day it goes to review.
11. **Portfolio push** (privacy + changelog): only with Filip's yes, right when he sends to review (his rule). Commit only the Subtitle Overlay files (other sessions work in cleedek-portfolio too); deploy happens automatically on push.
12. **Dashboard texts** for Filip in LISTING.md: new storage + Host permission justifications (each under 1,000 characters), Data usage unchanged (Website content already ticked; say you're not 100 % sure), manifest permissions unchanged = no permission prompt for users.
13. **Final checklist for Filip** in LISTING.md "Postup pro 1.1.0": upload zip, `fill.py` for 32 descriptions (tools in `store/dashboard/`), Privacy practices fields, Submit for review (always Filip, never automated; Chrome blocks extensions on the store page anyway).

## Rules and traps

- Filip's privacy rule: the live privacy page changes only when the version goes to the store; today it does, so prepare it, but push only on his word.
- Never type Filip's passwords; never submit for review yourself.
- Translations are written by Claude, no native review: say so.
- Other Claude sessions often edit the same files: check before overwriting, never revert someone else's uncommitted change.
- Puppeteer tests: pass `--disable-backgrounding-occluded-windows`, wait for the service worker before opening the page, fresh profile each run.
- If anything can't be finished today, say which item and offer to ship 1.1.0 without it (for example: no welcome page) rather than rushing it.

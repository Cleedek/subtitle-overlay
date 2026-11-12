# Handoff: Subtitle Overlay 1.1.0, release today (2026-11-12)

Goal: Filip uploads 1.1.0 to the Chrome Web Store **today** and sends it to review. Your job is to get everything ready so that he only has to click through the Dashboard. Talk to Filip in Czech (informal "ty"), plain language, he is a designer, not a coder. Never use em dashes or curly quotes. End every reply with "Confidence: X/10".

Read first: `store/LISTING.md`, section **"Postup pro 1.1.0"** (full plan, card texts, privacy bullets, risks). This handoff is the to-do list on top of it.

## Where things stand

- Repo `~/subtitle-overlay` (public GitHub Cleedek/subtitle-overlay, GPL). Local `main` at `c1eff8a` (1.0.20), **not pushed**. Manifest says 1.0.20.
- In the store: 1.0.19 (or 1.0.20 if Filip already sent it; **ask him first**, a new package can only be uploaded after the previous review is done or cancelled).
- Two finished features are switched off in `lib/settings.js`: `SHARING = false` (line ~368) and `REUSE_SAVED = false` (line ~373). Both were tested in two real Chrome profiles against a local server. 1.1.0 = switch both on.
- The store description and the 1.0.19 What's new card ALREADY promise saved-copy reuse ("comes back on any other page with the same subtitles"), which is off right now. 1.1.0 makes that true.
- Sharing server `~/subtitle-share` (Cloudflare Worker + D1, route subs.cleedek.com): **not deployed**. `DEPLOY.md` has the 4 steps, `npm test` passes 6/6. The `database_id` in `wrangler.jsonc` is still "TODO".
- Uncommitted work in the extension (other sessions did it; check `git status` and file mtimes, **another session may still be editing**, `batch.js` was being changed while this handoff was written):
  - welcome page after install: `welcome.html/.css/.js`, `welcome/` (demo.mp4, demo.jpg), opened from `background.js` onInstalled
  - **Improve** also for YouTube automatic captions in your own language (content.js `cleanable`/`startClean`, `CLEAN_PROMPT` in background.js)
  - Alt + = / Alt + − bigger/smaller subtitles, key labels follow the real keyboard layout (lib/settings.js)
  - YouTube CC button fixes (ccBefore, ccOffEarly in content.js)
  - popup footer spacing (popup.css), `asr` flag through popup.js
  - new strings in all 30 `lib/locales/*.json`
  - mockups/ (not shipped)
- `RECENT_SITES = false` in content.js (goodbye page recent sites): **keep it off** in 1.1.0 (untested, not in privacy).

## Decisions to get from Filip at the start (one short message, buttons if possible)

1. Is 1.0.20 already sent / approved?
2. Do all the uncommitted items above go into 1.1.0? (Recommended: yes, all, except RECENT_SITES.)
3. OK to deploy subs.cleedek.com now? (Required before review; never deploy without his yes.)
4. What's new card: approve the 9 points in LISTING.md "Karta Co je nového pro 1.1.0" or change them. His rule: Claude proposes CS+EN, he approves, then all languages.
5. "Find subtitles from others" stays **on by default** (his decision from 11. 11.) knowing the store-review risk in LISTING.md? Default: yes, keep on, disclose clearly.
6. Screenshot 2 swap (shared row instead of "Improving 46 %"): recommended **skip today** (32 languages to re-render); can come later without a new version.

## To do, in order

1. **Code freeze check:** make sure no other session is still writing in `~/subtitle-overlay` (mtimes, ask Filip). Read the uncommitted diff once so you know what ships.
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
6. **Commit** in logical pieces on local main (Co-Authored-By line as the system says). Push to GitHub only with Filip's yes (the repo is public).
7. **Zip:** `dist/subtitle-overlay-1.1.0.zip` via `git archive` of the runtime files (same file list as 1.0.20 + `welcome.*` and `welcome/`; no mockups, store, promo-video, tests). Unzip it into a fresh folder and load THAT in Chrome once to be sure.
8. **Store description**, all 32 `store/descriptions/*.txt` at once (else "Mismatching metadata"): changes listed in LISTING.md (NEW highlight line for shared subtitles, new SHARED SUBTITLES section, Improve for YouTube auto captions, shortcuts Alt + = / −, sharing sentence in PRIVACY). Write EN + CS first, show Filip, then the other 30. Keep under the store's character limit; Netflix stays out of store texts.
9. **Privacy policy:** `store/privacy-policy.html` AND `~/cleedek-portfolio` `privacy.astro` (EN + CS, same meaning), new date. Bullets are drafted in LISTING.md (lookup = first 5 characters of the fingerprint + language; sharing only after consent with what is sent; reports; IP only for rate limiting, verified not stored; takedown contact; new storage keys). The first sentence ("does not ... store on any server") must change.
10. **Website changelog:** skill `project-changelog` for the 1.1.0 entry (EN + CS), dated the day it goes to review.
11. **Portfolio push** (privacy + changelog): only with Filip's yes, right when he sends to review (his rule). Note: cleedek-portfolio has unrelated uncommitted Fondee work; commit only the Subtitle Overlay files, deploy happens automatically on push.
12. **Dashboard texts** for Filip in LISTING.md: new storage + Host permission justifications (each under 1,000 characters), Data usage unchanged (Website content already ticked; say you're not 100 % sure), manifest permissions unchanged = no permission prompt for users.
13. **Final checklist for Filip** in LISTING.md "Postup pro 1.1.0": upload zip, `fill.py` for 32 descriptions (tools in `store/dashboard/`), Privacy practices fields, Submit for review (always Filip, never automated; Chrome blocks extensions on the store page anyway).

## Rules and traps

- Filip's privacy rule: the live privacy page changes only when the version goes to the store; today it does, so prepare it, but push only on his word.
- Never type Filip's passwords; never submit for review yourself.
- Translations are written by Claude, no native review: say so.
- Other Claude sessions often edit the same files: check before overwriting, never revert someone else's uncommitted change.
- Puppeteer tests: pass `--disable-backgrounding-occluded-windows`, wait for the service worker before opening the page, fresh profile each run.
- If anything can't be finished today, say which item and offer to ship 1.1.0 without it (for example: no welcome page) rather than rushing it.

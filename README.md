# Subtitle Overlay

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kfiihdconjdcclppmdhopeejkbmkkalo?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=7c3aed)](https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-7c3aed)](LICENSE)

A Chrome extension (also works in Arc and other Chromium browsers) that puts subtitles on any video on the web: your own `.srt` / `.vtt` file, or the subtitles the site itself loads, translated into 31 languages, two languages at once, styled your way and sized to the player.

**[➜ Add to Chrome, free, from the Chrome Web Store](https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo)** (works in Arc, Edge, Brave and other Chromium browsers too)

[Privacy policy](https://cleedek.com/subtitle-overlay/privacy) · [Návod v češtině](README.cs.md)

The code is public so anyone can check what the extension does. It is plain JavaScript with no build step and no dependencies: what you read here is exactly what runs in your browser.

## What it does

- **Your own file:** load an `.srt` or `.vtt` file (or drop it on the video). Old encodings (Windows-1250, Windows-1258, Shift_JIS, GBK, Big5, EUC-KR and more) are detected automatically.
- **Subtitles found on the page:** when you turn on subtitles in a site's own player, the extension notices the subtitle file the player downloads (WebVTT, SRT, HLS playlists, YouTube captions) and offers it: show it your way, translate it, or save it as `.srt`.
- **Coming soon:** Netflix subtitles and TTML (`.ttml`, `.dfxp`) files. They are not in the Chrome Web Store version yet; the code is already here if you install from source.
- **Translation:** one click, or fully automatic, into 31 languages through Google Translate. Optionally Gemini (your own free API key), Claude or OpenAI (your own paid API key) or a local model (Ollama, LM Studio) rewrites Google's quick version with the whole scene in mind, a chunk at a time from where you are watching. It only starts when you click **Improve** (over the video or in the popup), never by itself, since a key costs money and a local model keeps the computer busy.
- **Translation queue:** drop in several `.srt` / `.vtt` files, or click **Add to queue** on subtitles a site loads, and they're translated one after another in the queue tab. Improved subtitles are kept under **Saved subtitles** for as long as you choose (a day to forever, or not at all) and come back when you return to the video; **Play** opens the page a file came from.
- **Two languages at once:** a second set at the other edge of the video.
- **Style:** 1,800+ Google Fonts, colour, outline, shadow, background box with blur, position, size that follows the player, your own presets.
- **Sync and shortcuts:** shift timing by 0.1 s or 1 s, repeat the current line, click a line to copy it, fullscreen with subtitles. Every shortcut can be changed.
- **Light or dark:** the popup and the extension's pages come in a dark (default) or light look, or follow the browser (Appearance, in the Interface group at the bottom of the popup, under every tab, next to the language).

## Privacy: what leaves your browser

There are no accounts, no analytics and no tracking. The extension talks to the network only in these cases:

| When | Where | What is sent |
| --- | --- | --- |
| You translate subtitles (button or automatic mode) | `translate.googleapis.com` | The subtitle text and the target language |
| You click Improve with Gemini as the translator (off by default) | `generativelanguage.googleapis.com` | The subtitle text, the target language and your API key |
| You click Improve with Claude as the translator (off by default) | `api.anthropic.com` | The subtitle text, the target language and your API key |
| You click Improve with OpenAI as the translator (off by default) | `api.openai.com` | The subtitle text, the target language and your API key |
| You click Improve with a local model as the translator (off by default) | The address you entered (default `localhost:11434`) | The subtitle text and the target language |
| Subtitles show with a Google Font (the default Vend Sans, or one you pick) | `fonts.googleapis.com`, `fonts.gstatic.com` | The font name |
| A site's player downloads subtitles | That same site | The extension downloads the same subtitle file (or its HLS playlist) again, nothing else |

Everything else (settings, presets, subtitles remembered for the last 30 pages; the second language of dual subtitles for at most 24 hours; the translation queue and saved subtitles; a count of translated videos, so the popup asks once for a rating) is stored only in your browser with `chrome.storage.local`. Full text: [privacy policy](https://cleedek.com/subtitle-overlay/privacy).

### Why it asks for these permissions

| Permission | Why |
| --- | --- |
| Read and change data on all websites (`<all_urls>`) | To draw subtitles over videos on any site and to read the subtitle files their players load |
| `webRequest` | To notice when a player downloads a subtitle file (only the address and file type are looked at; nothing is blocked or changed) |
| `scripting` | So the popup can ask the open page which videos it has |
| `storage` | To remember your settings, presets and recent subtitles locally |
| `unlimitedStorage` | So the translation queue and saved subtitles (whole files, a season at a time) aren't stopped by Chrome's 10 MB limit for extension storage |
| `declarativeNetRequestWithHostAccess` | Only with a local model: removes the Origin header from the extension's own requests to your local server, because Ollama refuses requests from browser extensions otherwise. Websites' requests are never changed |

You can turn the extension off for any site from the popup; on those sites it detects and shows nothing.

## Install

The easy way: **[install Subtitle Overlay from the Chrome Web Store](https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo)**. It updates by itself. The version there is built from this repository, but new work appears here first, so the store version can be a little behind.

### From source

If you would rather run the code exactly as it is here:

1. Download this repository (green **Code** button, **Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` (in Arc: `arc://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `subtitle-overlay` folder.

For local video files (`file://`), open the extension's **Details** and turn on **Allow access to file URLs**.

## How the code is organised

| File | What it does |
| --- | --- |
| `manifest.json` | Extension definition and permissions |
| `background.js` | Service worker: notices subtitle downloads, translation requests, font loading |
| `content.js` | Runs on each page: finds videos, draws subtitles, shortcuts, fullscreen, on-video cards |
| `youtube-hook.js` | YouTube only: copies the captions the YouTube player downloads |
| `popup.html` / `.css` / `.js` | The popup with the Subtitles, Style and Behaviour tabs |
| `panel.*`, `devtools.*` | Optional "Subtitles" panel in DevTools |
| `netflix-hook.js` | Netflix only: copies the subtitles the Netflix player downloads, recognised by their content (not in the store version yet) |
| `lib/subtitles.js` | Parsing SRT, VTT, TTML (not in the store version yet), HLS and YouTube formats, encodings, export |
| `lib/settings.js` | Settings, presets, languages, shortcuts |
| `lib/render.js` | Subtitle styling shared by the page and the popup preview |
| `lib/i18n.js`, `lib/locales/`, `_locales/` | Interface translations in 30 languages, one file per language loaded only when needed. Arabic is the one translation language without an interface, it needs right-to-left layout first |
| `lib/google-fonts.json` | List of Google Fonts with the alphabets each one supports |
| `samples/` | Test video and subtitle files for checking timing and encodings |
| `store/` | Chrome Web Store listing text and images |

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/Cleedek/subtitle-overlay/issues). If a site's subtitles are not detected, please say which site and whether its player uses WebVTT, TTML or something else (DevTools › Network shows the file).

If the extension is useful to you, a star here and a review in the [Chrome Web Store](https://chromewebstore.google.com/detail/subtitle-overlay/kfiihdconjdcclppmdhopeejkbmkkalo/reviews) help other people find it.

## Credits

Made by [Cleedek](https://cleedek.com) in Vietnam. Store images and the promo video use frames from *Tears of Steel* (© Blender Foundation, [mango.blender.org](https://mango.blender.org), CC BY 3.0).

## License

[GNU General Public License v3.0 only](LICENSE) (SPDX: `GPL-3.0-only`). You may use, study, change and share this code; if you publish a changed version, it has to stay open under the same license.

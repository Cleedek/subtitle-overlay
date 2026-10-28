# Subtitle Overlay

A Chrome extension (also works in Arc and other Chromium browsers) that puts subtitles on any video on the web: your own `.srt` / `.vtt` file, or the subtitles the site itself loads, translated into 31 languages, two languages at once, styled your way and sized to the player.

[Chrome Web Store](https://chromewebstore.google.com/search/Subtitle%20Overlay) · [Privacy policy](https://cleedek.com/subtitle-overlay/privacy) · [Návod v češtině](README.cs.md)

The code is public so anyone can check what the extension does. It is plain JavaScript with no build step and no dependencies: what you read here is exactly what runs in your browser.

## What it does

- **Your own file:** load an `.srt` or `.vtt` file (or drop it on the video). Old encodings (Windows-1250, Windows-1258, Shift_JIS, GBK, Big5, EUC-KR and more) are detected automatically.
- **Subtitles found on the page:** when you turn on subtitles in a site's own player, the extension notices the subtitle file the player downloads (WebVTT, HLS playlists, YouTube captions) and offers it: show it your way, translate it, or save it as `.srt`.
- **Translation:** one click, or fully automatic, into 31 languages through Google Translate.
- **Two languages at once:** a second set at the other edge of the video.
- **Style:** 1,800+ Google Fonts, colour, outline, shadow, background box with blur, position, size that follows the player, your own presets.
- **Sync and shortcuts:** shift timing by 0.1 s or 1 s, repeat the current line, click a line to copy it, fullscreen with subtitles. Every shortcut can be changed.

## Privacy: what leaves your browser

There are no accounts, no analytics and no tracking. The extension talks to the network only in these cases:

| When | Where | What is sent |
| --- | --- | --- |
| You translate subtitles (button or automatic mode) | `translate.googleapis.com` | The subtitle text and the target language |
| You pick a Google Font | `fonts.googleapis.com`, `fonts.gstatic.com` | The font name |
| A site's player downloads subtitles | That same site | The extension downloads the same subtitle file (or its HLS playlist) again, nothing else |

Everything else (settings, presets, subtitles remembered for the last 30 pages) is stored only in your browser with `chrome.storage.local`. Full text: [privacy policy](https://cleedek.com/subtitle-overlay/privacy).

### Why it asks for these permissions

| Permission | Why |
| --- | --- |
| Read and change data on all websites (`<all_urls>`) | To draw subtitles over videos on any site and to read the subtitle files their players load |
| `webRequest` | To notice when a player downloads a subtitle file (only the address and file type are looked at; nothing is blocked or changed) |
| `scripting` | So the popup can ask the open page which videos it has |
| `storage` | To remember your settings, presets and recent subtitles locally |

You can turn the extension off for any site from the popup; on those sites it detects and shows nothing.

## Install from source

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
| `lib/subtitles.js` | Parsing SRT, VTT, HLS and YouTube formats, encodings, export |
| `lib/settings.js` | Settings, presets, languages, shortcuts |
| `lib/render.js` | Subtitle styling shared by the page and the popup preview |
| `lib/i18n.js`, `lib/locales.js`, `_locales/` | Interface translations (English, Czech, Slovak, German, French, Spanish, Vietnamese, Chinese) |
| `lib/google-fonts.json` | List of Google Fonts with the alphabets each one supports |
| `samples/` | Test video and subtitle files for checking timing and encodings |
| `store/` | Chrome Web Store listing text and images |

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/Cleedek/subtitle-overlay/issues). If a site's subtitles are not detected, please say which site and whether its player uses WebVTT, TTML or something else (DevTools › Network shows the file).

If the extension is useful to you, a star here helps other people find it.

## Credits

Made by [Cleedek](https://cleedek.com) in Vietnam. Store images and the promo video use frames from *Tears of Steel* (© Blender Foundation, [mango.blender.org](https://mango.blender.org), CC BY 3.0).

## License

[GNU General Public License v3.0](LICENSE). You may use, study, change and share this code; if you publish a changed version, it has to stay open under the same license.

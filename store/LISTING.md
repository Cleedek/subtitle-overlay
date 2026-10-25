# Chrome Web Store: what to fill in

Everything below in English is ready to copy into the Chrome Web Store form. The Czech notes explain each step.

## Postup (co musíš udělat ty)

1. **Vývojářský účet:** jdi na https://chrome.google.com/webstore/devconsole, přihlas se Google účtem, odsouhlas podmínky a zaplať jednorázový poplatek 5 USD.
2. **Zásady ochrany soukromí:** jsou na portfoliu jako stránka https://cleedek.com/subtitle-overlay/privacy (v repu cleedek-portfolio, `src/pages/subtitle-overlay/privacy.astro`). **Pro 1.0.13 je text upravený** (titulky si pamatuje mezi návštěvami, max. 30 stránek; druhý jazyk; jazyk rozhraní; vlastní zkratka): změna je v `privacy.astro` i v `store/privacy-policy.html` a 25. 10. 2026 je nasazená na web (commit ef0b51b; Cloudflare portfolio sestaví sám po pushi do main).
3. **Nahraj balíček:** u existující položky otevři **Package** a klikni na **Upload new package**, nahraj `dist/subtitle-overlay-1.0.13.zip`. (Pokud položka ještě neexistuje, **New item**.)
4. **Vyplň záložky** podle textů níže (Store listing, Privacy practices).
5. **Obrázky:** ze složky `store/images` nahraj `screenshot-1.png` až `screenshot-5.png` (v tomto pořadí; staré screenshoty v obchodě smaž, všech 5 je nových: 2 = dva jazyky naráz i s panelem na vypnutí jednoho jazyka, 5 = opakování věty, načasování a kopírování) do Screenshots a `promo-tile-440x280.png` do Small promo tile, `marquee-promo-1400x560.png` do Marquee promo tile. Obrázky používají záběry z filmu Tears of Steel (Blender Foundation, licence CC BY 3.0); poděkování je přímo v obrázcích i na konci popisu, tak ho tam nech.
6. **Ikona v obchodě:** v Store listing do pole Store icon nahraj `icons/icon128.png`.
7. **Distribution:** Visibility = Public, Regions = All regions, Pricing = Free.
8. **Account** (levé menu): vyplň a ověř kontaktní e-mail, bez něj nejde odeslat.
9. Klikni na **Submit for review**. Kvůli přístupu na všechny weby počítej s delší kontrolou.

## Store listing

**Name:** Subtitle Overlay

**Summary (max 132 characters):**
Subtitles on any web video, always in sync: translated into 31 languages, dual subtitles, your own style, sized to fit the player.

(Obchod bere shrnutí z balíčku, tohle je jen pro kontrolu. Verze v dalších 7 jazycích jsou ve složce `_locales` a obchod si je vezme sám.)

**Category:** Accessibility (alternative: Tools)

**Language:** English

**Description:**

Watch any web video with subtitles in your language.

Subtitle Overlay draws subtitles on top of the video player of any website, also in fullscreen, and keeps them in sync with the video's own clock: pause, seek and playback speed all just work. Bring your own .srt or .vtt file, or use the subtitles the site already has, translated into your language. Watching together? Show two languages at once, one at the top and one at the bottom.

TRANSLATE INTO 31 LANGUAGES
• One click translates the loaded subtitles with Google Translate, right in the extension
• Pick your language once, right next to the Translate button; it stays your favourite
• Automatic mode: turn on subtitles in the site's player and they appear over the video already translated
• The site's own subtitles are hidden automatically, so you never read two sets at once
• Save the translation as an .srt file

TWO LANGUAGES AT ONCE
• Turn on second subtitles and pick any language for them: English at the top for you, Vietnamese at the bottom for your partner
• Or keep the original next to the translation, which is great for learning a language
• Each set has its own distance from the edge
• Turn either language off and on right over the video, with a switch next to its flag; the other one moves down to the usual spot

• Languages: Vietnamese, Czech, English, Slovak, German, French, Spanish, Italian, Portuguese, Polish, Hungarian, Ukrainian, Dutch, Swedish, Danish, Norwegian, Finnish, Greek, Turkish, Romanian, Croatian, Chinese (Simplified and Traditional), Japanese, Korean, Thai, Indonesian, Malay, Filipino, Hindi, Arabic

FINDS THE SUBTITLES A SITE LOADS
• When a page loads subtitles (VTT files or streaming subtitle playlists), a small card offers them, with the episode or film title when the page shares it
• Works on YouTube too: turn on CC and read the captions in your language; YouTube's CC button switches them on and off
• Hides sound labels like [Music] and the >> speaker marks (one switch, for anyone who wants them back)
• Show them your way, translate them, or save them as .srt in one click

STYLE THEM YOUR WAY
• 1,800+ Google Fonts, filtered to the ones that have the letters of your language (č ř ž, ư ế ộ, Cyrillic, Greek, Japanese and more)
• Size, weight, color, outline, drop shadow, background box (with optional blur behind it), line width
• Position at the bottom, in the middle or at the top of the video
• Presets (Clean, Boxed, High contrast) plus your own saved presets
• Text scales with the player size

FIX THE TIMING
• Shift subtitles earlier or later in 0.1 s or 1 s steps, from the popup or the keyboard

MADE FOR LEARNING
• Missed a line? Alt + R plays it again from the start
• Click any subtitle line to copy it, for a dictionary or your notes

LOAD YOUR OWN FILE
• Pick an .srt or .vtt file, or drag it straight onto the video
• Broken letters? Automatic text encoding detection (including Japanese, Chinese and Korean files) with a manual override
• Your subtitles come back when you reload the page or return to it later

YOUR CALL, SITE BY SITE
• Turn it off on any site with one switch; the list of turned-off sites is one click away

KEYBOARD SHORTCUTS
Alt + [ / ] sync · Alt + R repeat the line · Alt + S show or hide (pick your own shortcut) · Alt + ↑ / ↓ move · Alt + F fullscreen with subtitles

INTERFACE IN 8 LANGUAGES
English, Czech, Slovak, German, French, Spanish, Vietnamese and Chinese (Simplified). It follows your browser, or pick one at the bottom of the popup.

FOR TINKERERS
A "Subtitles" tab in DevTools lists every subtitle file the page loaded and can save it as .vtt or .srt.

PRIVACY
No accounts, no analytics, no tracking. Subtitle text is sent to Google Translate only when you translate. Remembered subtitles stay in your browser. Details in the privacy policy.

Screenshots show frames from Tears of Steel, © Blender Foundation, mango.blender.org, licensed CC BY 3.0.

## Česká verze obchodu (lokalizace)

**Postup:** v Developer Dashboard otevři **Store listing**, nahoře v rozbalovacím seznamu jazyka přidej/vyber **Czech (čeština)**. Vyplň popis níže a nahraj obrázky ze složky `store/images/cs` (stejné názvy a pořadí jako anglické). Název a krátké shrnutí si obchod vezme z balíčku (`_locales/cs`), ty se tu nevyplňují. Ukázky ve screenshotech jsou angličtina a čeština, rozhraní popupu je česky.

Nejsem si úplně jistý, jestli obchod dovolí vlastní screenshoty pro každý jazyk zvlášť (u popisu to jde určitě). Když pole na obrázky u češtiny neuvidíš, zůstanou tam anglické a nic se nerozbije.

**Popis (Description):**

Sleduj jakékoli video na webu s titulky ve svém jazyce.

Subtitle Overlay zobrazí titulky přes přehrávač na jakémkoli webu, i na celé obrazovce, a drží je v synchronizaci s videem: pauza, přetáčení i rychlost přehrávání prostě fungují. Nahraj vlastní soubor .srt nebo .vtt, nebo použij titulky, které už má web, přeložené do tvého jazyka. Díváte se ve dvou? Zobraz dva jazyky naráz, jeden nahoře a jeden dole.

PŘEKLAD DO 31 JAZYKŮ
• Jedním klikem přeložíš načtené titulky přes Google Translate, přímo v rozšíření
• Jazyk si vybereš jednou a zůstane uložený
• Automatický režim: zapni titulky v přehrávači webu a objeví se přes video rovnou přeložené
• Původní titulky webu se samy schovají, takže nečteš dvoje naráz
• Překlad si uložíš jako soubor .srt

DVA JAZYKY NARÁZ
• Zapni druhé titulky a vyber pro ně jakýkoli jazyk: nahoře angličtina pro tebe, dole čeština pro partnera
• Nebo nech originál vedle překladu, což se hodí na učení jazyků
• Každé titulky mají vlastní odstup od okraje
• Každý jazyk vypneš a zapneš přímo nad videem, přepínačem vedle jeho vlajky; ten druhý se pak přesune dolů na obvyklé místo

NAJDE TITULKY, KTERÉ WEB NAČTE
• Když stránka načte titulky (soubory VTT nebo streamované playlisty), malá karta ti je nabídne, i s názvem filmu nebo epizody, pokud ho stránka prozradí
• Funguje i na YouTube: zapni CC a čti titulky ve svém jazyce
• Schová popisky zvuků jako [Hudba] a značky mluvčích >> (jedním přepínačem je vrátíš)
• Zobrazit po svém, přeložit, nebo uložit jako .srt jedním klikem

STYL PODLE TEBE
• Přes 1 800 písem Google Fonts, vyfiltrovaných na ta, která mají písmena tvého jazyka (č ř ž, ư ế ộ, azbuka, řečtina, japonština a další)
• Velikost, tloušťka, barva, obrys, stín, podklad (i s rozmazáním za ním), šířka řádku
• Pozice dole, uprostřed nebo nahoře
• Předvolby (Čisté, V rámečku, Vysoký kontrast) a tvoje vlastní
• Text se přizpůsobí velikosti přehrávače

NAČASOVÁNÍ
• Posuň titulky dřív nebo později po 0,1 s nebo 1 s, v popupu nebo z klávesnice

PRO VÝUKU JAZYKŮ
• Ušla ti věta? Alt + R ji přehraje znovu od začátku
• Klikni na řádek titulků a zkopíruješ ho, třeba do slovníku

VLASTNÍ SOUBOR
• Vyber soubor .srt nebo .vtt, nebo ho přetáhni rovnou na video
• Rozsypané znaky? Automatické rozpoznání kódování (i japonské, čínské a korejské soubory) s ručním výběrem
• Titulky se vrátí, když stránku znovu načteš nebo se na ni později vrátíš

WEB PO WEBU
• Na kterémkoli webu rozšíření vypneš jedním přepínačem

KLÁVESOVÉ ZKRATKY
Alt + [ / ] načasování · Alt + R zopakovat větu · Alt + S zobrazit/skrýt (zkratku si můžeš změnit) · Alt + ↑ / ↓ posun · Alt + F celá obrazovka s titulky

ROZHRANÍ V 8 JAZYCÍCH
Čeština, slovenština, angličtina, němčina, francouzština, španělština, vietnamština a čínština (zjednodušená). Řídí se prohlížečem, nebo si jazyk vybereš dole v popupu.

PRO ŠŤOURALY
Záložka "Subtitles" v DevTools ukáže všechny soubory titulků, které stránka načetla, a uloží je jako .vtt nebo .srt.

SOUKROMÍ
Žádné účty, žádná analytika, žádné sledování. Text titulků jde do Google Translate jen ve chvíli, kdy překládáš. Zapamatované titulky zůstávají v tvém prohlížeči. Podrobnosti v zásadách ochrany soukromí.

Screenshoty ukazují záběry z filmu Tears of Steel, © Blender Foundation, mango.blender.org, licence CC BY 3.0.

## What's new (pro tebe, v obchodě se nikam nevyplňuje)

**Před odesláním 1.0.13 vyzkoušej YouTube u sebe v Arcu/Chromu** (pustit video se zvukem, zapnout CC). Automatický test ho na skutečném YouTube ověřit nemohl, protože YouTube testovacímu prohlížeči titulky neposílá. Kdyby to nefungovalo, odstav o YouTube z popisu vymaž.

Chrome Web Store nemá pole "co je nového"; uživatelé vidí nový popis a screenshoty. Kdybys to chtěl někde zmínit (web, sociální sítě):
1.0.13: Second subtitles in any language (two people, two languages, one at the top and one at the bottom). Alt + R repeats the current line. Switch each language on or off right over the video. Pick your own show/hide shortcut. Click a line to copy it. Subtitles at the bottom, middle or top. Blur behind the background box. Subtitles are remembered when you come back to a page. Japanese, Chinese and Korean file encodings. The interface now speaks English, Czech, Slovak, German, French, Spanish, Vietnamese and Chinese.

## Privacy practices tab

**Single purpose:**
Display subtitles as a styled, synchronized overlay on top of web videos, from a user-chosen file or from the subtitle files the current page loads, optionally translated into the user's language.

**Permission justifications:**

- **storage:** Saves the user's subtitle style settings, presets, timing offset, translation language and the sites the user turned the extension off on, remembers the subtitles loaded on a page (up to the last 30 pages, locally) so they come back on reload or a later visit, and stores the chosen interface language and second subtitle language.
- **scripting:** Asks each frame of the current tab which videos it contains, so the user can pick the video the subtitles belong to.
- **webRequest:** Observes (never blocks or changes) network requests in the current tab to notice subtitle files (.vtt, .srt, .m3u8 subtitle playlists) the page loads, so the user can display, translate or save them.
- **Host permission (all sites):** Videos with subtitles can be on any website, so the overlay must be able to run on any page and hide the site's own subtitles while it shows its own, and subtitle files the page loaded must be readable from their original address. On youtube.com a small script copies the caption file YouTube's own player downloads, because YouTube does not allow downloading it a second time.

**Remote code:** No, I am not using remote code. (Google Fonts font files are downloaded as data, and translations come back as plain text, not code.)

**Data usage:** tick **Website content** only (subtitle text is sent to Google Translate when the user translates). Nothing else is collected. Then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://cleedek.com/subtitle-overlay/privacy

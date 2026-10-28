# Chrome Web Store: what to fill in

Everything below in English is ready to copy into the Chrome Web Store form. The Czech notes explain each step.

## Postup (co musíš udělat ty)

1. **Vývojářský účet:** jdi na https://chrome.google.com/webstore/devconsole, přihlas se Google účtem, odsouhlas podmínky a zaplať jednorázový poplatek 5 USD.
2. **Zásady ochrany soukromí:** jsou na portfoliu jako stránka https://cleedek.com/subtitle-overlay/privacy (v repu cleedek-portfolio, `src/pages/subtitle-overlay/privacy.astro`). **Pro 1.0.13 je text upravený** (titulky si pamatuje mezi návštěvami, max. 30 stránek; druhý jazyk; jazyk rozhraní; vlastní zkratka): změna je v `privacy.astro` i v `store/privacy-policy.html` a 25. 10. 2026 je nasazená na web (commit ef0b51b; Cloudflare portfolio sestaví sám po pushi do main).
3. **Nahraj balíček:** u existující položky otevři **Package** a klikni na **Upload new package**, nahraj `dist/subtitle-overlay-1.0.16.zip`. (Pokud položka ještě neexistuje, **New item**.)
4. **Vyplň záložky** podle textů níže (Store listing, Privacy practices).
5. **Obrázky:** ze složky `store/images` nahraj `screenshot-1.png` až `screenshot-5.png` (v tomto pořadí; pro 1.0.15 se změnily 2, 4 a 5: popup se záložkami a vlastní zkratky, takže stačí vyměnit tyhle tři, nebo smaž staré a nahraj všech 5) do Screenshots a `promo-tile-440x280.png` do Small promo tile, `marquee-promo-1400x560.png` do Marquee promo tile. Obrázky používají záběry z filmu Tears of Steel (Blender Foundation, licence CC BY 3.0); poděkování je přímo v obrázcích i na konci popisu, tak ho tam nech.
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

**Description:** (obchod bere jen čistý text, bez tučného písma a odkazů; zvýraznění proto dělají hvězdičky ★ a nadpisy velkými písmeny. Zkopíruj celý blok.)

Watch any web video with subtitles in your language.

Subtitle Overlay draws subtitles over the video player of any website, also in fullscreen, and keeps them in sync with the video: pause, seek and playback speed just work. Use the subtitles the site already has, translated into your language, or bring your own .srt or .vtt file.

★ THE HIGHLIGHTS
★ Any site, any video: subtitles over the player, in a window or fullscreen, always in sync
★ Translate into 31 languages in one click, or fully automatically as soon as you turn on subtitles in the site's player
★ Two languages at once: one at the top, one at the bottom, for watching together or learning a language
★ Finds the subtitles the page loads, YouTube included, so you rarely need a file at all
★ Your style: 1,800+ Google Fonts, outline, shadow, background box, size and position
★ Free and open source: no ads, no account, no tracking, and every line of code is public

━━━━━━━━━━━━━━━━━━━━

TRANSLATE INTO 31 LANGUAGES
• One click translates the loaded subtitles with Google Translate, right in the extension
• Pick your language once; it stays your favourite for every Translate button
• Automatic mode: turn on subtitles in the site's player and they appear over the video already translated, with a short "Translated to …" note instead of a pop-up
• The site's own subtitles are hidden, so you never read two sets at once
• Switch back to the original any time, or save the translation as an .srt file
• Languages: Vietnamese, Czech, English, Slovak, German, French, Spanish, Italian, Portuguese, Polish, Hungarian, Ukrainian, Dutch, Swedish, Danish, Norwegian, Finnish, Greek, Turkish, Romanian, Croatian, Chinese (Simplified and Traditional), Japanese, Korean, Thai, Indonesian, Malay, Filipino, Hindi, Arabic

TWO LANGUAGES AT ONCE
• Turn on second subtitles in any language: English at the top for you, Vietnamese at the bottom for your partner
• Or keep the original next to the translation, which is great for learning
• Each set has its own distance from the edge
• A small panel over the video turns each language on or off, next to its flag; the other one moves to the usual spot

FINDS THE SUBTITLES A SITE LOADS
• When a page loads subtitles (VTT files or streaming subtitle playlists), a small card offers them, with the film or episode title when the page shares it
• YouTube: turn on CC and read the captions in your language; YouTube's own CC button switches them on and off, and the lines move up when the player controls appear
• Show, translate or save them as .srt in one click
• Several videos on one page? Pick which one the subtitles belong to

STYLE THEM YOUR WAY
• 1,800+ Google Fonts, filtered to the ones that have the letters of your language (č ř ž, ư ế ộ, Cyrillic, Greek, Japanese and more)
• Size, weight, color, outline (with its own opacity), drop shadow, background box (with optional blur behind it) and line width
• At the bottom, in the middle or at the top of the video
• Presets (Clean, Boxed, High contrast) plus your own saved looks
• Text scales with the player, with a live preview in the popup
• A tidy popup with three tabs: Subtitles, Style and Behaviour
• Hides sound labels like [Music] and the >> speaker marks (one switch brings them back)

FIX THE TIMING
• Shift subtitles earlier or later in 0.1 s or 1 s steps, from the popup or the keyboard
• The shift is remembered with the page

MADE FOR LEARNING
• Missed a line? Alt + R plays it again from the start
• Click any line to copy it, for a dictionary or your notes

YOUR OWN FILE
• Pick an .srt or .vtt file, or drag it straight onto the video
• Broken letters? Automatic text encoding detection (also Japanese, Chinese and Korean files) with a manual override
• Your subtitles come back when you reload the page or return to it later

FULLSCREEN THAT KEEPS THE SUBTITLES
• Alt + F or the button at the top of the video; F leaves it again
• Subtitles step aside when a site menu or notification covers them

SITE BY SITE
• Turn it off on any site with one switch; the list of turned-off sites is one click away

KEYBOARD SHORTCUTS
Alt + [ / ] sync · Alt + Shift + [ / ] sync by 1 s · Alt + 0 reset sync · Alt + R repeat the line · Alt + S show or hide · Alt + 1 / Alt + 2 show or hide just one language · Alt + ↑ / ↓ move · Alt + F fullscreen with subtitles
Every shortcut can be changed or switched off in the Behaviour tab.

INTERFACE IN 8 LANGUAGES
English, Czech, Slovak, German, French, Spanish, Vietnamese and Chinese (Simplified). It follows your browser, or pick one at the bottom of the popup.

FOR TINKERERS
A "Subtitles" tab in DevTools lists every subtitle file the page loaded and saves it as .vtt or .srt.

PRIVACY
No accounts, no analytics, no tracking. Subtitle text is sent to Google Translate only when you translate. Remembered subtitles stay in your browser. Details in the privacy policy.

OPEN SOURCE
The whole extension is open source (GPL-3.0), so anyone can check exactly what it does: github.com/Cleedek/subtitle-overlay. If you like it, a star on GitHub helps other people find it.

SUPPORT THE CREATOR
Subtitle Overlay is free and every feature stays free. If it makes your evenings better, the popup has a "Support the creator" page with Revolut, PayPal, Solana and Sui. Completely optional, and thank you!

Created with 💜 by Cleedek in Vietnam.

Screenshots show frames from Tears of Steel, © Blender Foundation, mango.blender.org, licensed CC BY 3.0.

## Česká verze obchodu (lokalizace)

**Postup:** v Developer Dashboard otevři **Store listing**, nahoře v rozbalovacím seznamu jazyka přidej/vyber **Czech (čeština)**. Vyplň popis níže a nahraj obrázky ze složky `store/images/cs` (stejné názvy a pořadí jako anglické). Název a krátké shrnutí si obchod vezme z balíčku (`_locales/cs`), ty se tu nevyplňují. Ukázky ve screenshotech jsou angličtina a čeština, rozhraní popupu je česky.

Nejsem si úplně jistý, jestli obchod dovolí vlastní screenshoty pro každý jazyk zvlášť (u popisu to jde určitě). Když pole na obrázky u češtiny neuvidíš, zůstanou tam anglické a nic se nerozbije.

**Popis (Description):**

Sleduj jakékoli video na webu s titulky ve svém jazyce.

Subtitle Overlay zobrazí titulky přes přehrávač na jakémkoli webu, i na celé obrazovce, a drží je v synchronizaci s videem: pauza, přetáčení i rychlost přehrávání prostě fungují. Použij titulky, které už web má, přeložené do svého jazyka, nebo nahraj vlastní soubor .srt či .vtt.

★ TO HLAVNÍ
★ Jakýkoli web, jakékoli video: titulky přes přehrávač, v okně i na celé obrazovce, vždy v synchronizaci
★ Překlad do 31 jazyků jedním klikem, nebo úplně sám, jakmile zapneš titulky v přehrávači webu
★ Dva jazyky naráz: jeden nahoře, druhý dole, pro společné sledování i učení jazyků
★ Najde titulky, které stránka načte, i na YouTube, takže soubor většinou vůbec nepotřebuješ
★ Tvůj styl: přes 1 800 písem Google Fonts, obrys, stín, podklad, velikost i pozice
★ Zdarma a open source: bez reklam, bez účtu, bez sledování, celý kód je veřejný

━━━━━━━━━━━━━━━━━━━━

PŘEKLAD DO 31 JAZYKŮ
• Jedním klikem přeložíš načtené titulky přes Google Translate, přímo v rozšíření
• Jazyk si vybereš jednou a platí pro všechna tlačítka Přeložit
• Automatický režim: zapni titulky v přehrávači webu a objeví se přes video rovnou přeložené, jen s krátkou poznámkou "Přeloženo: …"
• Původní titulky webu se schovají, takže nečteš dvoje naráz
• Kdykoli se vrátíš k originálu, nebo si překlad uložíš jako .srt
• Jazyky: vietnamština, čeština, angličtina, slovenština, němčina, francouzština, španělština, italština, portugalština, polština, maďarština, ukrajinština, nizozemština, švédština, dánština, norština, finština, řečtina, turečtina, rumunština, chorvatština, čínština (zjednodušená i tradiční), japonština, korejština, thajština, indonéština, malajština, filipínština, hindština, arabština

DVA JAZYKY NARÁZ
• Zapni druhé titulky v jakémkoli jazyce: nahoře angličtina pro tebe, dole čeština pro partnera
• Nebo nech originál vedle překladu, což se hodí na učení
• Každé titulky mají vlastní odstup od okraje
• Malý panel nad videem zapne a vypne každý jazyk, přepínačem vedle jeho vlajky; ten druhý se přesune na obvyklé místo

NAJDE TITULKY, KTERÉ WEB NAČTE
• Když stránka načte titulky (soubory VTT nebo streamované playlisty), malá karta ti je nabídne, i s názvem filmu nebo epizody, pokud ho stránka prozradí
• YouTube: zapni CC a čti titulky ve svém jazyce; tlačítko CC na YouTube je zapíná a vypíná a řádky se posunou nahoru, když se ukáže ovládání přehrávače
• Zobrazit, přeložit nebo uložit jako .srt jedním klikem
• Víc videí na stránce? Vybereš, ke kterému titulky patří

STYL PODLE TEBE
• Přes 1 800 písem Google Fonts, vyfiltrovaných na ta, která mají písmena tvého jazyka (č ř ž, ư ế ộ, azbuka, řečtina, japonština a další)
• Velikost, tloušťka, barva, obrys (i s vlastní průhledností), stín, podklad (i s rozmazáním za ním) a šířka řádku
• Dole, uprostřed nebo nahoře
• Předvolby (Čisté, V rámečku, Vysoký kontrast) a tvoje vlastní
• Text se přizpůsobí velikosti přehrávače, s živým náhledem v popupu
• Přehledný popup se třemi záložkami: Titulky, Vzhled a Chování
• Schová popisky zvuků jako [Hudba] a značky mluvčích >> (jedním přepínačem je vrátíš)

NAČASOVÁNÍ
• Posuň titulky dřív nebo později po 0,1 s nebo 1 s, v popupu nebo z klávesnice
• Posun si stránka pamatuje

PRO VÝUKU JAZYKŮ
• Ušla ti věta? Alt + R ji přehraje znovu od začátku
• Klikni na řádek titulků a zkopíruješ ho, třeba do slovníku

VLASTNÍ SOUBOR
• Vyber soubor .srt nebo .vtt, nebo ho přetáhni rovnou na video
• Rozsypané znaky? Automatické rozpoznání kódování (i japonské, čínské a korejské soubory) s ručním výběrem
• Titulky se vrátí, když stránku znovu načteš nebo se na ni později vrátíš

CELÁ OBRAZOVKA I S TITULKY
• Alt + F nebo tlačítko nahoře na videu; klávesou F ji zase opustíš
• Titulky ustoupí, když je zakryje menu nebo upozornění webu

WEB PO WEBU
• Na kterémkoli webu rozšíření vypneš jedním přepínačem; seznam vypnutých webů máš na jeden klik

KLÁVESOVÉ ZKRATKY
Alt + [ / ] načasování · Alt + Shift + [ / ] načasování po 1 s · Alt + 0 vynulovat · Alt + R zopakovat větu · Alt + S zobrazit/skrýt · Alt + 1 / Alt + 2 zobrazit/skrýt jen jeden jazyk · Alt + ↑ / ↓ posun · Alt + F celá obrazovka s titulky
Každou zkratku si na záložce Chování změníš nebo vypneš.

ROZHRANÍ V 8 JAZYCÍCH
Čeština, slovenština, angličtina, němčina, francouzština, španělština, vietnamština a čínština (zjednodušená). Řídí se prohlížečem, nebo si jazyk vybereš dole v popupu.

PRO ŠŤOURALY
Záložka "Subtitles" v DevTools ukáže všechny soubory titulků, které stránka načetla, a uloží je jako .vtt nebo .srt.

SOUKROMÍ
Žádné účty, žádná analytika, žádné sledování. Text titulků jde do Google Translate jen ve chvíli, kdy překládáš. Zapamatované titulky zůstávají v tvém prohlížeči. Podrobnosti v zásadách ochrany soukromí.

OPEN SOURCE
Celé rozšíření je open source (GPL-3.0), takže si kdokoli může ověřit, co přesně dělá: github.com/Cleedek/subtitle-overlay. Jestli se ti líbí, hvězda na GitHubu pomůže, aby ho našli i další.

PODPOŘ AUTORA
Subtitle Overlay je zdarma a všechny funkce zdarma zůstanou. Pokud ti zpříjemňuje večery, v popupu najdeš stránku "Podpořit autora" s Revolutem, PayPalem, Solanou a Sui. Úplně dobrovolně, a děkuju!

S 💜 ve Vietnamu vytváří Cleedek.

Screenshoty ukazují záběry z filmu Tears of Steel, © Blender Foundation, mango.blender.org, licence CC BY 3.0.

## What's new (pro tebe, v obchodě se nikam nevyplňuje)

**Před odesláním 1.0.13 vyzkoušej YouTube u sebe v Arcu/Chromu** (pustit video se zvukem, zapnout CC). Automatický test ho na skutečném YouTube ověřit nemohl, protože YouTube testovacímu prohlížeči titulky neposílá. Kdyby to nefungovalo, odstav o YouTube z popisu vymaž.

Chrome Web Store nemá pole "co je nového"; uživatelé vidí nový popis a screenshoty. Kdybys to chtěl někde zmínit (web, sociální sítě):
1.0.16: Local bank QR on the "Support the creator" page, shown to people using the extension in Czech (QR platba) or Vietnamese (VietQR). The GitHub link at the bottom is now a quiet "Open source on GitHub".

1.0.15: "Give us a star on GitHub" link at the bottom of the popup; the code is now open source on GitHub (GPL-3.0).

1.0.14: Tabs at the top of the popup (Subtitles, Style, Behaviour). Outline opacity. Alt + 1 and Alt + 2 show or hide only the main or only the second subtitles. Every keyboard shortcut can be changed or switched off. Turning YouTube captions off and on keeps the language you switched off hidden. A reset button for sync.

1.0.13: A "Support the creator" page (Revolut, PayPal, Solana, Sui). Second subtitles in any language (two people, two languages, one at the top and one at the bottom). Alt + R repeats the current line. Switch each language on or off right over the video. Pick your own show/hide shortcut. Click a line to copy it. Subtitles at the bottom, middle or top. Blur behind the background box. Subtitles are remembered when you come back to a page. Japanese, Chinese and Korean file encodings. The interface now speaks English, Czech, Slovak, German, French, Spanish, Vietnamese and Chinese.

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

# Chrome Web Store: what to fill in

Everything below in English is ready to copy into the Chrome Web Store form. The Czech notes explain each step.

## Postup pro 1.0.19 (co musíš udělat ty)

**Stav 11. 11. 2026 (odesláno):** Do 1.0.19 jde všechna práce z 10. a 11. 11. kromě dvou věcí, které jsou v kódu vypnuté přepínačem: **sdílení vylepšených titulků s ostatními** (`SubSettings.SHARING = false`, server subs.cleedek.com neběží; Filip 11. 11.: "schovat do příště") a **poslední weby pro stránku po odinstalaci** (`RECENT_SITES = false` v content.js, čeká na test a zásady). Lokální knihovna uložených titulků (otisk) jde. Nově v popisech (32 jazyků): hlášení problému ("Pomoc" + "Nahlásit problém"), uložené titulky i na jiné stránce, věta o hlášení v odstavci Privacy. Zásady: nová odrážka o hlášení problému (feedback.cleedek.com/report, ukládá se název webu, bez IP). Data usage: navíc zaškrtnout **Web history** (název webu v hlášení; přiznat víc je bezpečnější).

**Stav 10. 11. 2026:** V obchodě je 1.0.18. Commitnutá 1.0.19 (2cf1e9b) má kartu "Co je nového", "Pustit na…" ve frontě, aktualizaci upraveného vlastního stylu a jednorázovou kartu podpory nad videem. **Předpoklad těchto podkladů:** do 1.0.19 půjde i zatím necommitnutá práce z 10. 11. (titulky přímo od webu: YouTube, Netflix, HLS, a z 11. 11. i Prime Video a HBO Max/DASH; jazyk pro Netflix; průvodce Lokální AI se stažením Gemmy; přepínač Stavové zprávy; titulky webu schované jen, když běží naše). Pokud ne, z popisů vyhoď body označené (N) níže a ze zásad poslední tři nové odrážky.

**Co je připravené (necommitnuté):**

| Podklad | Kde | Stav |
|---|---|---|
| Popis ve 32 jazycích | `store/descriptions/<jazyk>.txt` (EN a CS i níže v tomhle souboru) | hotovo, překlady psal Claude, rodilí mluvčí nekontrolovali |
| Zásady ochrany soukromí | `store/privacy-policy.html` + `cleedek-portfolio/.../subtitle-overlay/privacy.astro` (EN slovo od slova stejné, CS překlad), datum 10. 11. 2026 | hotovo, web **není pushnutý** |
| Changelog na webu | `cleedek-portfolio/src/content/projects/{en,cs}/subtitle-overlay.md`, blok "Coming to the store" (+2 body: titulky od webu, Lokální AI) | hotovo, **není pushnutý** |
| Zdůvodnění storage, declarativeNetRequest a Host permission | níže v sekci Privacy practices (texty nahrazené) | hotovo |
| Karta "Co je nového" | `lib/whats-new.js` + 30 jazyků v `lib/locales` | hotovo 11. 11. (schváleno), ověřeno v Chromu (de, fi, ar, ja, cs, uk) |
| Nový screenshot 1 (podporované služby), 32 jazyků | `store/images/**/screenshot-1.png`, jiná session | rozpracované |
| Balíček zip | `dist/subtitle-overlay-1.0.19.zip` je z commitu 2cf1e9b, **bez** necommitnuté práce | sestavit znovu, až bude vše commitnuté |

**Změny v popisu (všech 32 jazyků naráz, jinak "Mismatching metadata"):**
- (N) Highlight "NOVĚ: fronta překladů…" nahrazený: když má web titulky ve tvém jazyce, dostaneš ty.
- (N) V sekci Překlad nový bod o titulcích od webu; bod "titulky webu se schovají" upřesněný (jen dokud běží naše).
- (N) Lokální AI: místo "3 kroky s příkazem" teď "popup tě provede, Gemma jedním kliknutím, aspoň 16 GB RAM".
- Fronta: přidané "Pustit na…".
- Podpora: místo "Revolut, PayPal, Solana a Sui" (PayPal a Sui už v popupu nejsou) teď "Ko-fi a několik dalších způsobů platby" + věta o jednorázové kartě nad videem (nejvýš 3 videa, jedno kliknutí a zmizí). Kartu přiznávám schválně, aby ji reviewer nebral jako nečekanou reklamu.
- Nový odstavec na konci (všech 32 jazyků): Subtitle Overlay je nezávislý projekt, není spojený s weby ani streamovacími službami, ty ho nepodporují ani nesponzorují, funkčnost je naše práce (vyzkoušeno, někde přizpůsobené přehrávači), názvy a loga patří vlastníkům. Služby v něm jmenovitě nejsou, takže sedí i k novému screenshotu s logy.
- Netflix v textech dál záměrně není.

**Postup v Dashboardu:**
1. **Web:** schválíš push cleedek-portfolio (zásady + changelog). Musí být online dřív, než odešleš ke kontrole, protože karta "Co je nového" i obchod na web odkazují.
2. **Package:** Upload new package, nově sestavený `dist/subtitle-overlay-1.0.19.zip`.
3. **Store listing:** popisy přes `store/dashboard/fill.py <kód> store/descriptions/<jazyk>.txt` pro všech 32 jazyků (nástroje ve `store/dashboard/`).
4. **Screenshot 1:** druhá session ho předělává ve všech 32 jazycích (`store/images/screenshot-1.png` a `store/images/<jazyk>/screenshot-1.png` se 10. 11. mění). V Dashboardu smaž starý screenshot 1 a nahraj nový na stejné místo (globální i v každém jazyce), přes `mkupload.py` + `moveleft.js`. Ostatní screenshoty nech.
5. **Privacy practices:** nahraď zdůvodnění **storage**, **declarativeNetRequestWithHostAccess** a **Host permission** texty níže. Data usage, Single purpose a Remote code beze změny. Pak znovu tři prohlášení.
6. Ulož koncept (`save.js`), zkontroluj a klikni **Submit for review** (to dělá vždycky člověk).

**Rizika, na která se podívej před odesláním:**
- **Jazyk pro Netflix (preferredTextLocale):** rozšíření mění požadavek přehrávače Netflixu, aby se objevily titulky, které Netflix ve tvém regionu běžně nenabízí. Jestli to reviewer nebo Netflix bude brát jako obcházení omezení, nevím jistě. Zdůvodnění to přiznává otevřeně. Bezpečnější varianta je pustit 1.0.19 bez téhle části.
- **Netflix na screenshotu** vs. rozhodnutí z 1.0.18 nechat Netflix mimo texty obchodu (riziko, že to bude znít jako obcházení DRM, a ochranná známka). Rozhodl ses pro screenshot, jen ať o tom víš.
- **Průvodce Lokální AI** je od 10. 11. přeložený do všech 30 jazyků rozhraní (překlady Claude, bez rodilých mluvčích). Stažení 8 GB přes skutečnou Ollamu v Chromu zatím nikdo nevyzkoušel.

### Karta "Co je nového" pro 1.0.19 (vybráno 11. 11. 2026)

Karta je karusel: 3 body na stránku (nejvýš 3 stránky), sama se přepne po 5 s, na najetí myší se zastaví a ukáže šipky u teček, jde posouvat tahem na trackpadu. Body (EN, překlady ve všech 30 jazycích v `lib/locales`):

1. Subtitles straight from the site: if it has them in your language (YouTube, Netflix, Prime Video, HBO Max and more), you get those instead of a translation
2. Free AI translation on your own computer: Local AI now sets itself up in two steps
3. Before Improve starts, the AI notes who is who, so names and forms of address stay consistent
4. Improved subtitles come back anywhere: the same subtitles on another page get your copy from Saved subtitles at once, without asking the AI again
5. The interface now comes in 23 more languages
6. Plus lots of smaller improvements and bug fixes

Bod 4 stojí na necommitnuté práci z 11. 11. (otisk titulků v Uložených titulcích). Pokud do 1.0.19 nepůjde, z `lib/whats-new.js` ho vyhoď.

## Postup pro 1.0.18 (co musíš udělat ty)

**Stav 8. 11. 2026:** Claude vyplnil Dashboard přes Arc (nástroje ve `store/dashboard/`): popisy ve všech 32 jazycích (`store/descriptions/<jazyk>.txt`), nový screenshot 2 (EN i CS), zdůvodnění storage a Host permission a Data usage. Uloženo jako koncept, balíček 1.0.18 v konceptu už byl. Zbývá jen zkontrolovat a kliknout **Submit for review**.

V obchodě je teď podle poznámek 1.0.17 (potvrď v Dashboardu, záložka Package). Položka existuje, takže jen aktualizuješ. Oprávnění v manifestu se proti 1.0.17 nezměnila, nová zdůvodnění oprávnění tedy nejsou potřeba.

1. **Web (zásady ochrany soukromí):** `cleedek-portfolio/src/pages/[...lang]/subtitle-overlay/privacy.astro` je upravená (EN + CS, datum 8. 11. 2026): formulář "Napiš mi", stránka po odinstalaci, poznámky "kdo je kdo" pro AI, automatický režim po nové instalaci, LM Studio. Anglický text je slovo od slova stejný jako `store/privacy-policy.html`. **Musí být online dřív, než odešleš ke kontrole** (commit + push, Claude to udělá na tvoje "jo").
2. **Nahraj balíček:** záložka **Package**, **Upload new package**, soubor `dist/subtitle-overlay-1.0.18.zip` (sestavený 8. 11. 2026 z commitu afb7aff, 98 souborů, ověřený v Chromu: popup EN/CS/AR, titulky přes video).
3. **Store listing, angličtina:** nahraď **Description** blokem níže (změny proti 1.0.17: automatický režim po instalaci, poznámky "kdo je kdo", tlačítko "Exit fullscreen", rozhraní v 31 jazycích s arabštinou, formulář v sekci Privacy a nová sekce PROBLEM OR IDEA?). Summary se bere z balíčku (beze změny).
4. **Další jazyky popisu:** v rozbalovacím seznamu jazyka nahoře ve Store listing postupně vyber Czech, German, Spanish, French, Slovak, Vietnamese a Chinese (Simplified) a do každého vlož celý obsah souboru `store/descriptions/<jazyk>.txt` (cs, de, es, fr, sk, vi, zh_CN). **Změň všech 8 najednou**, jinak obchod hlásí "Mismatching metadata" (stalo se u 1.0.17). Překlady psal Claude, rodilý mluvčí je nekontroloval.
5. **Screenshot 2 (nový, 8. 11. 2026):** ve Store listing smaž starý screenshot 2 a nahraj `store/images/screenshot-2.png` na stejné místo (pořadí 1 až 5 zůstává). V české verzi totéž s `store/images/cs/screenshot-2.png`. Ostatní screenshoty nech. Karta s hodnocením 4/10 a 8/10 je pryč, místo ní je jedna skutečná věta od Googlu a od Gemmy bez úprav (vietnamsky v EN, česky v CS). Video: viz níže.
6. **Privacy practices:** Data usage: nově zaškrtni **Personally identifiable information** (volitelný e-mail ve formuláři) a **Personal communications** (text zprávy). Nech **Website content** (a **Authentication information**, pokud jsi ho zaškrtl u 1.0.17). Pak znovu všechna tři prohlášení. Zdůvodnění **storage** a **Host permission** nahraď texty níže (doplněný formulář, poznámky a Netflix). Přesné názvy políček ověř ve formuláři, odvodil jsem je z dokumentace obchodu.
7. Klikni na **Submit for review**.

Ikona, dlaždice, Distribution, Privacy policy URL a kontaktní e-mail zůstávají.

## Obrázky a video pro 1.0.18

- **Novinky obrázky nepotřebují:** popup na screenshotu 5 vypadá v 1.0.18 stejně, formulář ani arabština nejsou vizuálně zásadní.
- **Screenshot 2 je předělaný** (8. 11.): místo hodnocení "Rated by my wife … 4/10 … 8/10", které obchod u 1.0.17 zamítl v textu jako "Keyword Spam" (Yellow Argon), ukazuje jednu skutečnou větu: Google vs. vylepšeno Gemmou. Zdroj: `promo-video/screens/screenshot-2(.cs).html`, render `node screens/render.mjs 2 2.cs` ve složce `promo-video`.
- **Promo video** hodnocení pořád ukazuje (5s scéna). Rozhodnutí, jestli ho předělat, je otevřené.
- **Netflix:** v textech obchodu záměrně není (riziko, že by to znělo jako obcházení DRM, a ochranná známka). Reviewer se o něm dozví ze zdůvodnění Host permission.

## Store listing

**Name:** Subtitle Overlay: Translate Video Subtitles with AI (z `_locales/*/messages.json`, každý jazyk má vlastní překlad za dvojtečkou; obchod ho bere z balíčku, v Dashboardu se nepíše)

**Summary (max 132 characters):**
Subtitles on any web video, in sync and in 31 languages. AI makes the translation sound natural, free on your own computer.

(Obchod bere shrnutí z balíčku, tohle je jen pro kontrolu. Verze v dalších 31 jazycích jsou ve složce `_locales` a obchod si je vezme sám (portugalština je tam dvakrát: `pt_BR` a `pt_PT`). Pro 1.0.18 beze změny; nově je tam i arabština.)

**Category:** Accessibility (alternative: Tools)

**Language:** English

**Description:** (obchod bere jen čistý text, bez tučného písma a odkazů; zvýraznění proto dělají hvězdičky ★ a nadpisy velkými písmeny. Zkopíruj celý blok.)

Watch any web video with subtitles in your language.

Subtitle Overlay draws subtitles over the video player of any website, also in fullscreen, and keeps them in sync with the video: pause, seek and playback speed just work. Use the subtitles the site already has, translated into your language, or bring your own .srt or .vtt file.

★ THE HIGHLIGHTS
★ Any site, any video: subtitles over the player, in a window or fullscreen, always in sync
★ Translate into 31 languages in one click, or fully automatically as soon as you turn on subtitles in the site's player
★ NEW: make the translation sound natural with AI, free on your own computer (Gemma) or with your own Gemini, Claude or OpenAI key
★ NEW: if the site already has subtitles in your language, you get those, and translation steps in only when it doesn't
★ Two languages at once: one at the top, one at the bottom, for watching together or learning a language
★ Finds the subtitles the page loads, YouTube included, so you rarely need a file at all
★ Your style: 1,800+ Google Fonts, outline, shadow, background box, size and position
★ Free and open source: no ads, no account, no tracking, and every line of code is public

━━━━━━━━━━━━━━━━━━━━

TRANSLATE INTO 31 LANGUAGES
• One click translates the loaded subtitles with Google Translate, right in the extension
• Optional: click Improve and AI (Gemma on your computer, or Gemini, Claude or OpenAI) rewrites Google's quick version so it sounds natural (more below). Move the mouse over the video to see how far it got
• Pick your language once; it stays your favourite for every Translate button
• Automatic mode: turn on subtitles in the site's player and they appear over the video already translated, with a short "Translated to …" note instead of a pop-up. New installs start with it on, translating into your browser's language
• If the site has subtitles in your language (YouTube and streaming sites), those come first; Google or AI only translate when there are none
• The site's own subtitles are hidden while ours are on and come back as soon as you turn ours off
• Switch back to the original any time, or save the translation as an .srt file
• Languages: Vietnamese, Czech, English, Slovak, German, French, Spanish, Italian, Portuguese, Polish, Hungarian, Ukrainian, Dutch, Swedish, Danish, Norwegian, Finnish, Greek, Turkish, Romanian, Croatian, Chinese (Simplified and Traditional), Japanese, Korean, Thai, Indonesian, Malay, Filipino, Hindi, Arabic

MAKE IT SOUND NATURAL (OPTIONAL)
Google Translate is quick, but it goes line by line, word for word. Click Improve and an AI model rewrites the subtitles with the whole scene in mind, starting where you are watching.
• Free: Gemma, Google's open model, runs on your own computer with Ollama or LM Studio, so the AI step stays on your computer. You need a fairly powerful computer and about 8 GB of disk space.
• The popup walks you through it: install Ollama from ollama.com, then download Gemma with one click (it needs at least 16 GB of RAM). More about it and the model we recommend right now: cleedek.com/subtitle-overlay/ai
• Or use your own API key: Gemini (has a free tier), Claude or OpenAI (paid).
• Before it starts, it skims the whole file and notes who is who, so gender, forms of address and names stay the same from the first line to the last.
• It never starts by itself: nothing runs and nothing is spent without your click.

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

TRANSLATION QUEUE AND SAVED SUBTITLES
• Drop in several .srt or .vtt files, or click "Add to queue" on subtitles a site loads. They're translated one after another while you do something else; the queue tab can stay in the background
• Works with Google, Gemini, Claude, OpenAI or your local model
• Improved subtitles are kept in the extension for as long as you choose, and come back when you return to the video
• Play opens the video with its subtitles, "Show on…" puts them over a video already open in another tab, and Download saves the .srt

STYLE THEM YOUR WAY
• 1,800+ Google Fonts, filtered to the ones that have the letters of your language (č ř ž, ư ế ộ, Cyrillic, Greek, Japanese and more)
• Size, weight, color, outline (with its own opacity), drop shadow, background box (with optional blur behind it) and line width
• At the bottom, in the middle or at the top of the video
• Presets (Clean, Boxed, High contrast) plus your own saved looks
• Text scales with the player, with a live preview in the popup
• A tidy popup with three tabs: Subtitles, Style and Behaviour, in a dark or light look (or follow your system)
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
• Alt + F or the button at the top of the video; F or the "Exit fullscreen" button leaves it again
• Subtitles step aside when a site menu or notification covers them

SITE BY SITE
• Turn it off on any site with one switch; the list of turned-off sites is one click away

KEYBOARD SHORTCUTS
Alt + [ / ] sync · Alt + Shift + [ / ] sync by 1 s · Alt + 0 reset sync · Alt + R repeat the line · Alt + S show or hide · Alt + 1 / Alt + 2 show or hide just one language · Alt + ↑ / ↓ move · Alt + F fullscreen with subtitles
Every shortcut can be changed or switched off in the Behaviour tab.

INTERFACE IN 31 LANGUAGES
English, Czech, Slovak, German, French, Spanish, Vietnamese, Simplified Chinese, Traditional Chinese, Italian, Portuguese, Polish, Ukrainian, Hungarian, Dutch, Swedish, Danish, Norwegian, Finnish, Greek, Turkish, Romanian, Croatian, Japanese, Korean, Thai, Indonesian, Malay, Filipino, Hindi, and Arabic (right to left). It follows your browser, or pick one at the bottom of the popup.

FOR TINKERERS
A "Subtitles" tab in DevTools lists every subtitle file the page loaded and saves it as .vtt or .srt.

PRIVACY
No accounts, no analytics, no tracking. Subtitle text is sent to Google Translate only when subtitles are translated (by your click or by automatic mode), and to Gemini, Claude, OpenAI or your local model only when you click Improve. Remembered and saved subtitles stay in your browser. If you write to me with "Write to me" in the popup, your message reaches me by email. Details in the privacy policy.

PROBLEM OR IDEA?
Click "Problem or idea?" at the bottom of the popup and write to me. I read every message.

OPEN SOURCE
The whole extension is open source (GPL-3.0), so anyone can check exactly what it does: github.com/Cleedek/subtitle-overlay. If you like it, a star on GitHub helps other people find it.

SUPPORT THE CREATOR
Subtitle Overlay is free and every feature stays free. If it makes your evenings better, the popup has a "Support the creator" page with Ko-fi and a few other ways to pay. After many translated videos, a small card over the video asks once too (on three videos at most; one click on it and it's gone for good). Completely optional, and thank you!

Created with 💜 by Cleedek in Vietnam.

Subtitle Overlay is an independent project. It is not affiliated with, endorsed by or sponsored by any of the websites or streaming services it works with. Support for them is our own work: we tested it on those sites and, on some of them, adapted it to their players. Names and logos of those services belong to their owners.

Screenshots show frames from Tears of Steel, © Blender Foundation, mango.blender.org, licensed CC BY 3.0.

## Česká verze obchodu (lokalizace)

**Postup:** v Developer Dashboard otevři **Store listing**, nahoře v rozbalovacím seznamu jazyka vyber **Czech (čeština)** a nahraď popis blokem níže. Název a krátké shrnutí si obchod vezme z balíčku (`_locales/cs`), ty se tu nevyplňují.

**Obrázky:** české screenshoty z 1.0.17 (`store/images/cs`) jsou v obchodě; měnit je jen pokud se rozhodneš předělat screenshot 2 (viz výše). České video je `promo-video/out/subtitle-overlay-promo-cs-1080p.mp4`: nahraj ho na YouTube (Unlisted) a odkaz vlož do české verze, pokud tam pole pro video je (nejsem si jistý, jestli ho obchod u překladu nabízí; jinak se ukáže anglické).

**Popis (Description):**

Sleduj jakékoli video na webu s titulky ve svém jazyce.

Subtitle Overlay zobrazí titulky přes přehrávač na jakémkoli webu, i na celé obrazovce, a drží je v synchronizaci s videem: pauza, přetáčení i rychlost přehrávání prostě fungují. Použij titulky, které už web má, přeložené do svého jazyka, nebo nahraj vlastní soubor .srt či .vtt.

★ TO HLAVNÍ
★ Jakýkoli web, jakékoli video: titulky přes přehrávač, v okně i na celé obrazovce, vždy v synchronizaci
★ Překlad do 31 jazyků jedním klikem, nebo úplně sám, jakmile zapneš titulky v přehrávači webu
★ NOVĚ: s AI zní překlad přirozeně, zdarma ve tvém počítači (Gemma) nebo s vlastním klíčem Gemini, Claude či OpenAI
★ NOVĚ: když má web titulky ve tvém jazyce, dostaneš rovnou ty a překládá se jen tam, kde chybí
★ Dva jazyky naráz: jeden nahoře, druhý dole, pro společné sledování i učení jazyků
★ Najde titulky, které stránka načte, i na YouTube, takže soubor většinou vůbec nepotřebuješ
★ Tvůj styl: přes 1 800 písem Google Fonts, obrys, stín, podklad, velikost i pozice
★ Zdarma a open source: bez reklam, bez účtu, bez sledování, celý kód je veřejný

━━━━━━━━━━━━━━━━━━━━

PŘEKLAD DO 31 JAZYKŮ
• Jedním klikem přeložíš načtené titulky přes Google Translate, přímo v rozšíření
• Volitelně: klikneš na Vylepšit a AI (Gemma ve tvém počítači, nebo Gemini, Claude či OpenAI) rychlý překlad od Googlu přepíše, aby zněl přirozeně (víc níže). Když pohneš myší nad videem, uvidíš, kolik už je hotovo
• Jazyk si vybereš jednou a platí pro všechna tlačítka Přeložit
• Automatický režim: zapni titulky v přehrávači webu a objeví se přes video rovnou přeložené, jen s krátkou poznámkou "Přeloženo: …". Po nové instalaci je zapnutý a překládá do jazyka tvého prohlížeče
• Má web titulky ve tvém jazyce (YouTube a streamovací služby)? Pak dostaneš ty; Google nebo AI překládá, jen když žádné nejsou
• Původní titulky webu se schovají, dokud běží naše, a vrátí se, jakmile naše vypneš
• Kdykoli se vrátíš k originálu, nebo si překlad uložíš jako .srt
• Jazyky: vietnamština, čeština, angličtina, slovenština, němčina, francouzština, španělština, italština, portugalština, polština, maďarština, ukrajinština, nizozemština, švédština, dánština, norština, finština, řečtina, turečtina, rumunština, chorvatština, čínština (zjednodušená i tradiční), japonština, korejština, thajština, indonéština, malajština, filipínština, hindština, arabština

PŘIROZENÝ PŘEKLAD S AI (VOLITELNĚ)
Google Translate je rychlý, ale překládá řádek po řádku, slovo od slova. Klikni na Vylepšit a AI model titulky přepíše s ohledem na celou scénu, od místa, kde se díváš.
• Zdarma: Gemma, otevřený model od Googlu, běží přímo ve tvém počítači přes Ollamu nebo LM Studio, takže krok s AI z počítače neodchází. Potřebuješ výkonnější počítač a asi 8 GB místa na disku.
• Popup tě nastavením provede: nainstaluj Ollamu z ollama.com a jedním kliknutím stáhni Gemmu (potřebuje aspoň 16 GB RAM). Víc o tom a model, který teď doporučujeme (anglicky): cleedek.com/subtitle-overlay/ai
• Nebo vlastní API klíč: Gemini (má bezplatnou úroveň), Claude nebo OpenAI (placené).
• Než začne, projde celý soubor a poznamená si, kdo je kdo, takže rod, oslovení i jména sedí od první věty po poslední.
• Sám se nikdy nespustí: bez tvého kliknutí nic neběží a nic neutratíš.

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

FRONTA PŘEKLADŮ A ULOŽENÉ TITULKY
• Přidej několik souborů .srt nebo .vtt, nebo klikni na "Přidat do fronty" u titulků, které web načte. Přeloží se jeden po druhém, zatímco děláš něco jiného; záložka s frontou může zůstat na pozadí
• Funguje s Googlem, Gemini, Claude, OpenAI i s tvým lokálním modelem
• Vylepšené titulky zůstanou v rozšíření tak dlouho, jak si vybereš, a vrátí se, když se k videu vrátíš
• Přehrát otevře video i s titulky, "Pustit na…" je dá na video, které máš otevřené v jiné záložce, a Stáhnout uloží .srt

STYL PODLE TEBE
• Přes 1 800 písem Google Fonts, vyfiltrovaných na ta, která mají písmena tvého jazyka (č ř ž, ư ế ộ, azbuka, řečtina, japonština a další)
• Velikost, tloušťka, barva, obrys (i s vlastní průhledností), stín, podklad (i s rozmazáním za ním) a šířka řádku
• Dole, uprostřed nebo nahoře
• Předvolby (Čisté, V rámečku, Vysoký kontrast) a tvoje vlastní
• Text se přizpůsobí velikosti přehrávače, s živým náhledem v popupu
• Přehledný popup se třemi záložkami: Titulky, Vzhled a Chování, v tmavém nebo světlém provedení (nebo podle systému)
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
• Alt + F nebo tlačítko nahoře na videu; klávesou F nebo tlačítkem "Ukončit celou obrazovku" ji zase opustíš
• Titulky ustoupí, když je zakryje menu nebo upozornění webu

WEB PO WEBU
• Na kterémkoli webu rozšíření vypneš jedním přepínačem; seznam vypnutých webů máš na jeden klik

KLÁVESOVÉ ZKRATKY
Alt + [ / ] načasování · Alt + Shift + [ / ] načasování po 1 s · Alt + 0 vynulovat · Alt + R zopakovat větu · Alt + S zobrazit/skrýt · Alt + 1 / Alt + 2 zobrazit/skrýt jen jeden jazyk · Alt + ↑ / ↓ posun · Alt + F celá obrazovka s titulky
Každou zkratku si na záložce Chování změníš nebo vypneš.

ROZHRANÍ V 31 JAZYCÍCH
Angličtina, čeština, slovenština, němčina, francouzština, španělština, vietnamština, čínština (zjednodušená), čínština (tradiční), italština, portugalština, polština, ukrajinština, maďarština, nizozemština, švédština, dánština, norština, finština, řečtina, turečtina, rumunština, chorvatština, japonština, korejština, thajština, indonéština, malajština, filipínština, hindština a arabština (zprava doleva). Řídí se prohlížečem, nebo si jazyk vybereš dole v popupu.

PRO ŠŤOURALY
Záložka "Subtitles" v DevTools ukáže všechny soubory titulků, které stránka načetla, a uloží je jako .vtt nebo .srt.

SOUKROMÍ
Žádné účty, žádná analytika, žádné sledování. Text titulků jde do Google Translate jen ve chvíli, kdy se titulky překládají (tvým kliknutím nebo automatickým režimem), a do Gemini, Claude, OpenAI nebo tvého lokálního modelu jen když klikneš na Vylepšit. Zapamatované i uložené titulky zůstávají v tvém prohlížeči. Když mi napíšeš přes "Napiš mi" v popupu, zpráva mi přijde e-mailem. Podrobnosti v zásadách ochrany soukromí.

PROBLÉM NEBO NÁPAD?
Klikni dole v popupu na "Problém nebo nápad?" a napiš mi. Čtu každou zprávu.

OPEN SOURCE
Celé rozšíření je open source (GPL-3.0), takže si kdokoli může ověřit, co přesně dělá: github.com/Cleedek/subtitle-overlay. Jestli se ti líbí, hvězda na GitHubu pomůže, aby ho našli i další.

PODPOŘ AUTORA
Subtitle Overlay je zdarma a všechny funkce zdarma zůstanou. Pokud ti zpříjemňuje večery, v popupu najdeš stránku "Podpořit autora" s Ko-fi a několika dalšími způsoby platby. Po hodně přeložených videích se jednou zeptá i malá karta nad videem (nejvýš u tří videí; jedno kliknutí a už se neukáže). Úplně dobrovolně, a děkuju!

S 💜 ve Vietnamu vytváří Cleedek.

Subtitle Overlay je nezávislý projekt. Není spojený s žádným z webů ani streamovacích služeb, se kterými funguje, ty ho nepodporují ani nesponzorují. Že na nich funguje, je naše vlastní práce: vyzkoušeli jsme ho tam a na některých ho přímo přizpůsobili jejich přehrávači. Názvy a loga těch služeb patří jejich vlastníkům.

Screenshoty ukazují záběry z filmu Tears of Steel, © Blender Foundation, mango.blender.org, licence CC BY 3.0.

## What's new (pro tebe, v obchodě se nikam nevyplňuje)

Chrome Web Store nemá pole "co je nového"; uživatelé vidí nový popis a screenshoty. Kdybys to chtěl někde zmínit (web, sociální sítě):

1.0.18: Before improving the subtitles, the AI skims the whole file and notes who is who, so gender, forms of address and names stay consistent. New installs translate automatically into your browser's language. The interface now speaks 31 languages, Arabic included (right to left). "Problem or idea?" at the bottom of the popup lets you write to me directly. Clearer AI error messages with tips, an alert with a Restart button if the extension's background stops, an "Exit fullscreen" button, a one-language switch right over the video, and fixes for players like Prima+ (ads, audio switch) and YouTube (visible tags in captions, the CC button, nothing of ours on the miniplayer).

1.0.17: Make the translation sound natural with AI. Google's quick translation shows at once; click Improve and Gemma on your own computer (free, with Ollama or LM Studio), Gemini (your own free API key), Claude or OpenAI (your own paid API key) rewrites it with the whole scene in mind, starting where you are watching. It never starts by itself; move the mouse over the video to see how far it got. New translation queue: drop in a whole season of subtitle files and they're translated one after another in the background; improved subtitles are saved for as long as you choose and come back when you return to the video, YouTube included. The popup, the queue and the DevTools panel come in a dark or light look. After 10 translated videos, the popup asks once whether you'd rate or share the extension. Smoother on YouTube: moving the mouse over the video or scrolling the page no longer slows it down. A language you switch off over the video stays off when you come back (and isn't translated meanwhile). On tall videos and Shorts the language panel keeps to the player's corner, and the fullscreen button no longer covers subtitles at the top. YouTube's CC button only switches the subtitles when you press it, not when YouTube flips it by itself (going fullscreen, around ads).

1.0.16: Local bank QR on the "Support the creator" page, shown to people using the extension in Czech (QR platba) or Vietnamese (VietQR). The GitHub link at the bottom is now a quiet "Open source on GitHub".

1.0.15: "Give us a star on GitHub" link at the bottom of the popup; the code is now open source on GitHub (GPL-3.0).

1.0.14: Tabs at the top of the popup (Subtitles, Style, Behaviour). Outline opacity. Alt + 1 and Alt + 2 show or hide only the main or only the second subtitles. Every keyboard shortcut can be changed or switched off. Turning YouTube captions off and on keeps the language you switched off hidden. A reset button for sync.

1.0.13: A "Support the creator" page (Revolut, PayPal, Solana, Sui). Second subtitles in any language (two people, two languages, one at the top and one at the bottom). Alt + R repeats the current line. Switch each language on or off right over the video. Pick your own show/hide shortcut. Click a line to copy it. Subtitles at the bottom, middle or top. Blur behind the background box. Subtitles are remembered when you come back to a page. Japanese, Chinese and Korean file encodings. The interface now speaks English, Czech, Slovak, German, French, Spanish, Vietnamese and Chinese.

## Privacy practices tab

**Single purpose:**
Display subtitles as a styled, synchronized overlay on top of web videos, from a user-chosen file or from the subtitle files the current page loads, optionally translated into the user's language.

**Permission justifications:**

- **storage:** Saves the user's subtitle style settings, presets, the colors picked last, timing offset, translation language, translator choice (with the user's own Gemini, Claude or OpenAI API key or local model address, if entered), light or dark look and the sites the user turned the extension off on; remembers the subtitles loaded on a page (up to the last 30 pages, locally; the second language of dual subtitles for at most 24 hours) so they come back on reload or a later visit; keeps the subtitle files the user put in the translation queue and the improved subtitles the user chose to keep; counts translated videos locally to decide when to ask once for a rating; stores the chosen interface language and second subtitle language; keeps an unsent draft of the "Write to me" form; remembers the version the extension was updated from, to show a short "What's new" card once; counts videos improved by AI and the day counting started, plus fingerprints of up to three pages where a one-time support card showed, to decide when that card appears; and keeps in session storage, until the browser closes, the AI translator's short who-is-who notes for a subtitle file, the subtitle languages a Netflix or Prime Video tab offers, and the progress of a local model download the user started. Nothing of this leaves the device (a "Write to me" message is sent only when the user presses Send).
- **unlimitedStorage:** The translation queue and the "Saved subtitles" list keep whole subtitle files (a season of episodes, each with its original and translated lines) in the extension's local storage. Without this permission Chrome's 10 MB limit for extension storage would make adding to the queue or saving fail. Everything stays on the user's device, and the user can delete each file or choose how long improved subtitles are kept.
- **scripting:** Asks each frame of the current tab which videos it contains, so the user can pick the video the subtitles belong to.
- **webRequest:** Observes (never blocks or changes) network requests in the current tab to notice subtitle files (.vtt, .srt, .m3u8 subtitle playlists) the page loads, so the user can display, translate or save them.
- **declarativeNetRequestWithHostAccess:** Used only for a local model the user chose (translating with it, or downloading a model into it from the setup guide): one rule removes the Origin header from the extension's own requests to the local model server address the user entered (by default Ollama on localhost), because Ollama refuses requests that carry a browser extension's Origin. Requests made by websites are never changed.
- **Host permission (all sites):** Videos with subtitles can be on any website, so the overlay must be able to run on any page and hide the site's own subtitles while it shows its own, and subtitle files the page loaded must be readable from their original address. Before translating, the extension checks whether the site itself offers subtitles in the user's language and, if so, downloads that file from the site instead of sending text to a translator. On youtube.com a small script copies the caption file YouTube's own player downloads (YouTube does not allow downloading it a second time) and reads the list of caption languages from the player; a caption file in another language is fetched from the same address with only the language changed. On netflix.com a small script copies the TTML subtitle file the player receives (video data passes through untouched and is never read beyond its first bytes, saved or sent anywhere) and reads the list of subtitle files in the data the player receives. It also adds the user's translation language to the player's request for that list (preferredTextLocale), so subtitles in that language are listed when Netflix has them; nothing else in the request is changed, and that language is kept in netflix.com's localStorage until the user turns the extension off on Netflix. On primevideo.com and Amazon's sites a small script reads the list of subtitle files in the answer Prime Video's player receives when a title starts; it changes nothing and asks for nothing extra. On other sites (HBO Max, for example) the subtitle tracks are read from the streaming manifest (HLS playlist or DASH .mpd) the page loaded. The extension also sends subtitle text to the translator the user picked (Google Translate, the Gemini, Claude or OpenAI API, or the user's own local model server, whose address can be any host).

**Remote code:** No, I am not using remote code. (Google Fonts font files are downloaded as data, and translations come back as plain text, not code.)

**Data usage:** tick **Website content** (subtitle text is sent to Google Translate when subtitles are translated, and to Gemini, Claude, OpenAI or a local model only when the user clicks Improve), **Personal communications** (the message the user writes in "Write to me") and **Personally identifiable information** (the optional reply email in that form). Then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).

Poznámka k Data usage (nejsem si jistý): API klíč, který si uživatel zadá pro Gemini, Claude nebo OpenAI, se posílá jen té službě, aby se u ní přihlásil. Ty ho nikdy nedostaneš, ale obchod by ho mohl brát jako **Authentication information**. Doporučuju to zaškrtnout taky (můj odhad, ne ověřené pravidlo): přiznat víc je bezpečnější než vynechat něco, co obchod za data považuje. Na stránce v obchodě pak bude u rozšíření vidět, že pracuje s přihlašovacími údaji.

**Privacy policy URL:** https://cleedek.com/subtitle-overlay/privacy

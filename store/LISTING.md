# Chrome Web Store: what to fill in

Everything below in English is ready to copy into the Chrome Web Store form. The Czech notes explain each step.

## Postup pro 1.1.0 (příprava 12. 11. 2026, NIC z toho ještě není provedené)

Hlavní věc: **sdílené titulky** (`SHARING = true`) + **znovupoužití vlastních uložených titulků** (`REUSE_SAVED = true`). Obojí je v kódu hotové a otestované ve dvou Chromech, jen vypnuté.

**Pozor, už dnes:** popis v obchodě (od 1.0.19) i karta "Co je nového" 1.0.19 slibují, že vylepšené titulky "se vrátí na jakékoli jiné stránce se stejnými titulky". Od d4fb8e7 je to vypnuté (`REUSE_SAVED = false`), takže obchod teď slibuje něco, co nefunguje. 1.1.0 to srovná.

### Co musíš rozhodnout ty

1. **Stav 1.0.20:** je odeslaná / schválená? 1.1.0 jde nahrát až po ní (nebo po Cancel review).
2. **Co dalšího jde do 1.1.0** (stav 12. 11. 08:00: všechno už je commitnuté a pushnuté v 15170dc, b64a76d, 49b8885; navíc i **průběh fronty překladů v kartě nad videem**):
   - uvítací stránka po instalaci (welcome.*, welcome/demo.mp4; jen nové instalace)
   - **Vylepšit** i pro automatické titulky YouTube ve tvém jazyce (interpunkce, přeslechnutá slova)
   - zkratky Alt + = / Alt + − (větší / menší titulky), popisky kláves podle skutečné klávesnice
   - opravy tlačítka CC na YouTube (vypnutí poslední řeči, CC vypnuté během načítání)
   - **poslední weby na stránce po odinstalaci** (`RECENT_SITES = true` od 12. 11.): otestováno v Chromu (video se pamatuje i při automatickém přehrání, malé náhledy ne, skutečné odebrání otevře stránku s weby), server nasazený 12. 11. Při vydání: nahrát nové zásady (store/privacy-policy.html + web cleedek.com, obojí s datem 12. 11.); v Privacy practices se nic nemění (Web history už je zaškrtnuté od 1.0.19).
3. **Spuštění serveru subs.cleedek.com** (`~/subtitle-share/DEPLOY.md`, 4 příkazy). Bez tvého "ano" nenasazuju. Musí běžet dřív, než 1.1.0 projde kontrolou.
4. **Karta "Co je nového"** (níže): vyber body.

### Karta "Co je nového" pro 1.1.0 (návrh k odsouhlasení)

Jak to funguje dnes: karta ukáže všechny záznamy novější než verze, ze které člověk přišel. Kdo má 1.0.19/1.0.20, viděl by jen body 1.1.0. Proto návrh: **jeden záznam 1.1.0**, nahoře novinky, pod nimi zopakované hlavní věci z 1.0.17 až 1.0.19 (vyšly 4., 9. a 11. 11., hodně lidí si jich nevšimlo). Starý záznam 1.0.19 smazat, jinak by lidé z 1.0.18 viděli body dvakrát. Nadpis = stávající "v posledních verzích" (už přeložený ve 30 jazycích). 9 bodů = přesně 3 stránky karuselu.

Nové v 1.1.0:
1. CS: **Sdílené titulky**: když stejné titulky už někdo vylepšil pomocí AI, dostaneš jeho verzi hned, bez čekání. Jestli budeš sdílet i ty svoje, rozhodneš sám
   EN: **Shared subtitles**: if someone already improved the same subtitles with AI, you get their version right away. Whether you share yours is up to you
2. CS: Vylepšené titulky se vrátí kdekoli: na jiné stránce se stejnými titulky se hned použije tvoje kopie z **Uložených titulků**, AI nemusí pracovat znovu
   EN: Improved subtitles come back anywhere: the same subtitles on another page get your copy from **Saved subtitles** at once, without asking the AI again
3. CS: **Vylepšit** teď umí i automatické titulky YouTube ve tvém jazyce: doplní interpunkci a opraví přeslechnutá slova
   EN: **Improve** now also works on YouTube's automatic captions in your own language: it adds punctuation and fixes misheard words

Z posledních verzí:
4. CS: Titulky přímo od webu: když je má ve tvém jazyce (YouTube, **Netflix**, **Prime Video**, HBO Max a další), dostaneš ty místo překladu
   EN: (stávající text z 1.0.19)
5. CS: Překlad pomocí AI zdarma na tvém počítači: **Lokální AI** se nastaví ve dvou krocích (stávající)
6. CS: Než **Vylepšit** začne, AI si zapíše, kdo je kdo, takže jména a oslovení sedí (stávající)
7. CS: Titulky se neukazují? Štítek **Pomoc** na videu tě provede a **Nahlásit problém** mi pošle název webu
   EN: Subtitles don't show? The **Help** label on the video walks you through it, and **Report a problem** sends me the site's name
8. CS: Větší a menší titulky klávesami **Alt + =** a **Alt + −** (jen pokud zkratky jdou do 1.1.0; jinak sem "Rozhraní ve 23 dalších jazycích")
9. Spousta menších vylepšení a oprav (stávající)

Bod 2 byl už v kartě 1.0.19 (tehdy nefungoval). Nové texty (1, 3, 7, 8) přeložím do 30 jazyků až po tvém výběru.

### Obchod: popis (všech 32 jazyků naráz, jinak "Mismatching metadata")

Potřeba změnit, ano:
- **★ Highlights:** řádek "NEW: make the translation sound natural with AI…" nechat (bez NEW), nový řádek "NEW: shared subtitles: if someone already improved these subtitles with AI, you get them at once; sharing yours is your choice".
- **Nová sekce "SHARED SUBTITLES"** (za MAKE IT SOUND NATURAL): hledání je zapnuté, posílá jen začátek otisku titulků, nikdy adresu ani název; "Používat sdílené automaticky" je vypnuté; sdílení vlastních až po kartě se souhlasem, jedním kliknutím smažeš vše sdílené; nahlášení špatné kopie.
- **YOUR OWN FILE / Translation:** bod o Vylepšit pro automatické titulky YouTube.
- **KEYBOARD SHORTCUTS:** + "Alt + = / − bigger or smaller" (pokud jde do verze).
- **PRIVACY odstavec:** věta o sdílení (co se posílá při hledání a co jen se souhlasem).
- Bod o Uložených titulcích "on any other page with the same subtitles" už tam je; s 1.1.0 začne platit.

### Obchod: screenshoty

- **Nutné: žádné.** Žádný současný screenshot neukazuje nic, co by v 1.1.0 přestalo platit.
- **Doporučené (volitelné):** screenshot 2 ("Subtitles that sound like people talk") má vpravo nahoře kartu "gemma3:12b 46 % Improving". Výměna za řádek se sdílenou verzí ("♻ SHARED · improved 2 days ago by #4F2A · Use") by novinku ukázala bez nového obrázku. Obchod dovolí max 5 screenshotů, takže jen výměna, ne přidání. Znamená to přerenderovat 32 jazyků.
- Screenshot 4 (fronta) ukazuje starší vzhled fronty bez přepínače "Vylepšit pomocí AI"; nevadí, přepínač na obrázku není vidět.

### Zásady ochrany soukromí (store/privacy-policy.html + cleedek-portfolio privacy.astro, EN + CS)

Potřeba změnit, **ano**: dnes první věta říká, že rozšíření "nic neukládá na server". Se sdílením to už neplatí. Nové odrážky:
- **Hledání sdílených titulků** (zapnuté od začátku): z časování a textu původních titulků se v prohlížeči spočítá jednosměrný otisk; na subs.cleedek.com jde jen jeho prvních 5 znaků a cílový jazyk. Server vrátí všechny kopie s tímhle začátkem, správná se vybere v prohlížeči. Žádná adresa stránky, název videa ani účet. Vypíná se "Hledat titulky od ostatních".
- **Sdílení vlastních** (jen po souhlasu, vypnuté od začátku): celý otisk, jazyk, název modelu, počet řádků, jak dlouho AI pracovala, vylepšené titulky (.srt) a náhodný kód instalace (zobrazí se ostatním jako krátká značka typu #4F2A). Kdo má stejné původní titulky, může si je stáhnout. "Smazat moje sdílené" smaže vše z této instalace.
- **Nahlášení sdílené kopie:** číslo kopie + náhodný kód; 3 nahlášení od různých lidí kopii schovají.
- **IP adresa:** server běží na Cloudflare, který IP použije jen k omezení příliš mnoha požadavků, k titulkům se neukládá (ověřeno 12. 11. v kódu: tabulky `subs` a `reports` sloupec s IP nemají, IP jde jen do limitu `env.LIMIT`).
- **Kontakt pro stažení obsahu** (autorská práva): e-mail, kam napsat. Viz rizika.
- Úložiště: náhodný kód instalace, počet sdílených, odpověď na kartu souhlasu, rozložení klávesnice.
- Datum zásad + changelog na webu (skill project-changelog) až při odeslání, jako u 1.0.19.

### Privacy practices v Dashboardu

Hotové texty pro 1.1.0 (nahradí stávající; počet znaků: storage 920, Host 933, limit 1 000):

- **storage (1.1.0):** Saves, on the device only: style settings and presets, timing offset, languages, translator choice (with the user's own Gemini, Claude or OpenAI key or local model address, if entered), light or dark look, sites where the extension is off, and the keyboard layout for shortcut labels; subtitles loaded on a page (last 30 pages); queued subtitle files and the improved subtitles the user keeps; counters for the rating, support and "What's new" cards; an unsent "Write to me" draft; hint and report codes; up to three recent video site names for the uninstall page; for shared subtitles, a random install code, the share count and the answer to the sharing card; and, in session storage, the AI's who-is-who notes, a streaming tab's subtitle languages and local model download progress. Data leaves the device only as the privacy policy describes: Send in a form, a shared-subtitles lookup, or a share the user agreed to.
- **Host permission (1.1.0):** Videos with subtitles can be on any website, so the overlay must run on any page, hide the site's own subtitles while showing its own, and read subtitle files the page loaded from their original address. Before translating, it checks whether the site offers subtitles in the user's language and downloads that file instead: YouTube's caption address with only the language changed, the subtitle list Netflix's or Prime Video's player receives, or the HLS/DASH manifest the page loaded. On netflix.com it adds the user's language to the player's subtitle list request (preferredTextLocale); nothing else is changed and video data is never read. Subtitle text goes only to the translator the user picked. To find subtitles others improved, the first 5 characters of a one-way fingerprint of the subtitles and the language go to subs.cleedek.com (the developer's server); improved subtitles go there only after the user agrees to share.
- **Data usage:** Website content už je zaškrtnuté a pokrývá to. Nic nového zaškrtávat nevidím, ale nejsem si jistý (viz rizika).
- **Oprávnění v manifestu se nemění** (manifest má v gitu jen změnu verze), takže uživatelům se po aktualizaci neukáže žádný dialog s novými oprávněními.
- Single purpose a Remote code beze změny.

### Rizika

- **Hledání zapnuté od začátku:** obchod chce u odesílání dat, která nejsou nutná pro hlavní funkci, jasné upozornění a někdy souhlas. Posílá se jen 5 znaků otisku a jazyk, což podle mě nejsou osobní data, ale jistý si nejsem. Bezpečnější varianta: hledání zapnout až po kliknutí na kartu (stejně jako sdílení).
- **Autorská práva:** veřejně sdílené překlady titulků filmů a seriálů jsou odvozené dílo. Server je zná jen podle otisku (bez názvu), ale držitel práv může poslat žádost o stažení. Doporučuju kontakt pro stažení v zásadách a v adminu možnost kopii smazat. Nejsem právník.
- Překlady nových textů psal Claude, rodilí mluvčí nekontrolovali.

### Pořadí při vydání

1. Rozhodnutí výše → commit, `SHARING` + `REUSE_SAVED` na true, verze 1.1.0, nová karta + 30 jazyků.
2. Nasadit subs.cleedek.com, ověřit `curl` z DEPLOY.md a jeden test se dvěma profily proti ostrému serveru.
3. Zip přes `git archive` (pokud jde uvítací stránka, přidat `welcome.*` a `welcome/`).
4. Zásady + changelog na webu push ve chvíli odeslání ke kontrole.
5. Dashboard: balíček, 32 popisů (`fill.py`), případně screenshot 2, Privacy practices, Submit for review (ty).

## Postup pro 1.0.20 (opravná verze, 11. 11. 2026)

Jen oprava chyb, takže stačí **Package > Upload new package** se souborem `dist/subtitle-overlay-1.0.20.zip` a **Submit for review**. Popisy, screenshoty, zásady ani Privacy practices se nemění (žádná nová funkce ani oprávnění).

- Opravy: tlačítka překladače ve frontě (teď přepínač "Vylepšit pomocí AI" jako v popupu), čára nad "Nahlásit problém", tlačítko celé obrazovky při načítání dalšího dílu, dlouhé názvy efektů (de, da, nl, no).
- Zip: z commitu 578386d + jen tyhle opravy (batch.*, content.js, popup.css, lib/whats-new.js, manifest), 102 souborů jako 1.0.19. Uvítací stránka z jiné session v něm **není**. Sdílení a znovupoužití uložených titulků jsou dál vypnuté (to je 1.1.0).
- Karta "Co je nového": 1.0.20 nemá vlastní záznam. Kdo přejde z 1.0.18, uvidí kartu 1.0.19; kdo ji už viděl v 1.0.19, neuvidí ji znovu. Odkaz v patičce dál ukazuje "Co je nového ve verzi 1.0.19".
- Pokud je 1.0.19 ještě v kontrole, nový balíček půjde nahrát až po **Cancel review** (nebo po schválení 1.0.19).

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

- **storage:** Saves, on the device only: the user's style settings and presets, timing offset, languages, translator choice (with the user's own Gemini, Claude or OpenAI API key or local model address, if entered), light or dark look and the sites where the extension is off; the subtitles loaded on a page (last 30 pages) so they come back on a later visit; queued subtitle files and the improved subtitles the user keeps; local counters that decide when the rating, support and "What's new" cards show; an unsent "Write to me" draft; the sites where the "turn on subtitles" hint already showed, and a random code that makes a problem report count once per day; and, in session storage until the browser closes, the AI's who-is-who notes, the subtitle languages a streaming tab offers and the progress of a local model download. Nothing leaves the device unless the user presses Send in "Write to me" or "Report a problem".
- **unlimitedStorage:** The translation queue and the "Saved subtitles" list keep whole subtitle files (a season of episodes, each with its original and translated lines) in the extension's local storage. Without this permission Chrome's 10 MB limit for extension storage would make adding to the queue or saving fail. Everything stays on the user's device, and the user can delete each file or choose how long improved subtitles are kept.
- **scripting:** Asks each frame of the current tab which videos it contains, so the user can pick the video the subtitles belong to.
- **webRequest:** Observes (never blocks or changes) network requests in the current tab to notice subtitle files (.vtt, .srt, .m3u8 subtitle playlists) the page loads, so the user can display, translate or save them.
- **declarativeNetRequestWithHostAccess:** Used only for a local model the user chose (translating with it, or downloading a model into it from the setup guide): one rule removes the Origin header from the extension's own requests to the local model server address the user entered (by default Ollama on localhost), because Ollama refuses requests that carry a browser extension's Origin. Requests made by websites are never changed.
- **Host permission (all sites):** Videos with subtitles can be on any website, so the overlay must run on any page, hide the site's own subtitles while it shows its own, and read subtitle files the page loaded from their original address. Before translating, it checks whether the site offers subtitles in the user's language and downloads that file from the site instead: YouTube's own caption address with only the language changed; the subtitle list in the data Netflix's or Prime Video's player receives; or the HLS/DASH manifest the page loaded (HBO Max, for example). On netflix.com it also adds the user's translation language to the player's request for that list (preferredTextLocale), so subtitles in that language are listed when Netflix has them; nothing else is changed and video data is never read or saved. Subtitle text goes only to the translator the user picked (Google Translate, Gemini, Claude, OpenAI or the user's local model server, which can be any address).

**Remote code:** No, I am not using remote code. (Google Fonts font files are downloaded as data, and translations come back as plain text, not code.)

**Data usage:** tick **Website content** (subtitle text is sent to Google Translate when subtitles are translated, and to Gemini, Claude, OpenAI or a local model only when the user clicks Improve), **Personal communications** (the message the user writes in "Write to me") and **Personally identifiable information** (the optional reply email in that form) and **Web history** (the site name in a "Report a problem" report). Then tick all three certifications (no selling data, no unrelated use, no creditworthiness use).

Poznámka k Data usage (nejsem si jistý): API klíč, který si uživatel zadá pro Gemini, Claude nebo OpenAI, se posílá jen té službě, aby se u ní přihlásil. Ty ho nikdy nedostaneš, ale obchod by ho mohl brát jako **Authentication information**. Doporučuju to zaškrtnout taky (můj odhad, ne ověřené pravidlo): přiznat víc je bezpečnější než vynechat něco, co obchod za data považuje. Na stránce v obchodě pak bude u rozšíření vidět, že pracuje s přihlašovacími údaji.

**Privacy policy URL:** https://cleedek.com/subtitle-overlay/privacy

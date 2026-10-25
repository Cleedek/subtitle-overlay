# Subtitle Overlay

Rozšíření pro Chrome a Arc: zobrazí tvoje vlastní titulky (SRT nebo VTT) přes jakékoli video na webu, i ve fullscreenu, a umí najít VTT titulky, které si stránka sama stahuje (třeba Prima+).

## Instalace (jednou)

1. Otevři stránku s rozšířeními:
   - **Arc:** do adresního řádku napiš `arc://extensions`
   - **Chrome:** `chrome://extensions`
2. Vpravo nahoře zapni **Developer mode** (Režim pro vývojáře).
3. Klikni na **Load unpacked** a vyber složku `subtitle-overlay` (tu, ve které je tento soubor).
4. Připni si ikonu (fialový čtvereček s čárkami) do lišty, ať ji máš po ruce.

**Lokální videa (soubor .mp4 otevřený v prohlížeči):** na stránce rozšíření klikni u Subtitle Overlay na **Details** a zapni **Allow access to file URLs**.

## Aktualizace

Když se změní soubory ve složce, otevři znovu `arc://extensions` (nebo `chrome://extensions`) a u Subtitle Overlay klikni na ikonu šipky v kruhu (Reload). Pak obnov stránku s videem.

## Jak se to používá

**Vlastní soubor:** klikni na ikonu rozšíření, **Load .srt / .vtt file**, vyber soubor. Nebo soubor rovnou přetáhni myší na video.

**Titulky ze stránky (Prima+ a podobné):**
1. Pusť video a v přehrávači stránky zapni titulky (tlačítko CC / Titulky). Teprve tehdy si stránka titulky stáhne.
2. Za chvilku se vpravo nahoře na videu objeví okénko **Subtitles found** se dvěma tlačítky:
   - **Download .srt** uloží titulky do Stažených souborů jako .srt.
   - **Show over video** je zobrazí přes video s tvým nastavením vzhledu. Původní titulky stránky pak v přehrávači vypni, ať nejsou dvakrát.
3. Okénko po 20 s samo zmizí. Kdybys ho propásl, stejné soubory najdeš po kliknutí na ikonu rozšíření v sekci **Found on this page** (číslo na ikoně říká, kolik jich je).

**YouTube:** zapni v přehrávači YouTube titulky (tlačítko CC). Rozšíření si je vezme ve chvíli, kdy je stáhne přehrávač, a nabídne je stejně jako jinde: karta s Download .srt / Show over video / Translate, v automatickém režimu rovnou přeložené. Funguje i s automaticky generovanými titulky (překlad je u nich slabší, protože YouTube je dělí na kousky vět). YouTube nechává starý řádek na obrazovce, i když už naskočil nový; rozšíření proto vždy ukáže jen ten aktuální, takže se nikdy nesejdou 4 řádky. Titulky YouTube se při zobrazení našich schovají.

**Zvukové popisky:** v Style › Behaviour je přepínač **Hide sound labels** (zapnutý). Schová [Music] / [hudba], popisky velkými písmeny jako (LAUGHS), řádky jen s notami ♪ a značky >>, kterými YouTube označuje změnu mluvčího. Neslyšícím ty popisky pomáhají, proto jdou vypnout. Stahované .srt zůstávají celé.

**Tlačítko CC na YouTube:** když běží titulky z YouTube a v přehrávači YouTube vypneš CC, naše titulky zmizí; zapnutím se vrátí. U vlastního souboru tlačítko nic nedělá.

**Lišta přehrávače YouTube:** když na video najedeš myší nebo ho pozastavíš, YouTube ukáže dole progress bar a tlačítka. Titulky se v tu chvíli plynule posunou nad ně a po schování lišty se vrátí. Na celé obrazovce se neposouvají vůbec, aby neposkakovaly při každém pohybu myši.

**Vypnutí na webu:** v rozšíření je hned nahoře přepínač **On [web]**. Když ho vypneš, rozšíření na tom webu nic nehledá ani neukazuje (titulky, které zrovna běží, zmizí). Seznam vypnutých webů je v sekci **Turned off on**, každý jde tlačítkem **Turn on** zase zapnout. Vypnutí webu platí i pro jeho subdomény.

**Panel "Subtitles" v DevTools (záloha, když rozšíření soubor nestáhne):**
1. Na stránce s videem otevři DevTools (Cmd + Option + I) a nahoře vyber záložku **Subtitles** (může být schovaná pod `>>`).
2. Panel vidí jen to, co se stáhlo, **když už byly DevTools otevřené**. Takže obnov stránku nebo až teď zapni titulky v přehrávači.
3. Tlačítka jsou stejná jako v rozšíření. Rozdíl je, že panel bere obsah přímo z DevTools, takže funguje i tam, kde nové stažení stránka odmítne.

**Písmo a presety:**
- V sekci Style je vyhledávání ve všech Google Fonts (přes 1 800 písem). Filtr **č ř ž** ukáže jen písma s českými znaky. Druhý filtr se řídí jazykem překladu (vietnamština **ư ế ộ**, ukrajinština **ї є ґ**, japonština…); u jazyků s obyčejnou latinkou (italština, němčina) není potřeba, ty umí každé písmo. Písmo se stáhne i se znaky jazyka překladu. Po změně jazyka obnov stránku s videem, ať se písmo stáhne znovu. Písmo se stáhne až ve chvíli, kdy ho použiješ.
- Všechno se ukládá samo. Tlačítko **Save as preset** dole uloží celý aktuální vzhled pod tvým jménem. Preset se pak objeví vedle Clean / Boxed / High contrast. Křížkem u něj ho smažeš.

**Překlad (Google Translate, přímo v rozšíření):**
- Když máš načtené titulky, v rozšíření je pod nimi řádek **Translate to [jazyk] Translate**. Jazyk vybereš rovnou tam a rozšíření si ho pamatuje jako tvůj oblíbený (výchozí je vietnamština). Překlad trvá zhruba sekundu a hned se ukáže přes video.
- **Show original** vrátí původní titulky, **Download .srt** uloží přeložené (např. `film.vi.srt`).
- U nalezených titulků (v okénku na videu i v rozšíření) je navíc tlačítko **Translate to …**, které titulky rovnou zobrazí přeložené do oblíbeného jazyka.
- Text titulků se posílá Googlu (stejná bezplatná služba, kterou používá Google Translate na webu, bez klíče). Google ji může při velkém množství požadavků dočasně omezit.
- **Translate automatically** (sekce Translation v rozšíření): zapneš jednou. Pak stačí v přehrávači stránky zapnout titulky (třeba české) a jakmile je rozšíření zachytí, rovnou se přeloží do tvého jazyka a ukážou přes video. Okénko "Subtitles found" se v tomhle režimu neukazuje; nahoře uprostřed jen krátce naskočí "Translating…" a pak "Translated to …". Okénko se objeví jen když se překlad nepovede, s tlačítky pro ruční postup. Titulky, které sis načetl ručně, automatika nikdy nepřepíše.
- **Titulky stránky se schovají samy**, jakmile běží tvoje. Rozšíření ví, jaký řádek stránka ukazuje (je to stejný soubor), najde jeho rámeček u videa a schová ho pravidlem, které platí i pro všechny další řádky, takže nové titulky stránky se vůbec nevykreslí (ani neproblikne). Ovládání přehrávače nechá být. Kdyby se to u nějakého webu nepovedlo, ukáže vlevo nahoře upozornění "Two sets of subtitles" a titulky pak vypneš v přehrávači sám.
- Titulky zapnuté hned po načtení stránky (v první sekundě nebo dvou) se zachytí taky: rozšíření nabídku opakuje, dokud se na stránce nespustí, a po spuštění si samo řekne o titulky nalezené v poslední minutě.
- Karta nalezených titulků ukazuje název epizody nebo filmu, pokud ho stránka prozradí (název v systémovém ovládání médií, sdílecí titulek, nebo titulek záložky).
- Ruční cesta přes translate-subtitles.com zůstala jako odkaz po stažení .srt.

**Posun (sync):** když titulky jdou pozdě nebo brzo, použij tlačítka v sekci Sync nebo zkratky níže. Kladné číslo = titulky se ukážou později. Posun se pamatuje i pro další soubory a u každé stránky zvlášť (viz níže).

**Titulky z minula:** rozšíření si u každé stránky pamatuje poslední titulky i jejich posun (jen v tomhle počítači, posledních 30 stránek). Po obnovení stránky se vrátí samy. Když na stránku přijdeš později (po zavření prohlížeče), nahoře na videu se po spuštění ukáže **Subtitles from last time: … Show**; jedním kliknutím se vrátí i s posunem. **Remove** v rozšíření je zapomene.

**Druhé titulky (dva jazyky naráz):** v sekci Translation zapni **Second subtitles** a vyber **Second language**: originál nebo jakýkoli z 31 jazyků. Druhé titulky jsou u opačného okraje než hlavní (hlavní dole = druhé nahoře a naopak), odstup nastavíš posuvníkem **Second subtitles: distance from top/bottom**. Příklad: francouzský film, hlavní titulky přeložené do vietnamštiny (Translate to), druhé do češtiny; obojí se překládá z francouzského originálu. Druhý jazyk znamená jeden požadavek na Google navíc na soubor. Vzhled mají oboje stejný.

**Vypnout jeden z jazyků:** když jsou druhé titulky zapnuté, po pohybu myši nad videem se vpravo nahoře ukáže malý panel s oběma jazyky (vlajka, název, přepínač). Každý jazyk tam vypneš a zapneš zvlášť, třeba když partner odejde. Zbylé titulky se pak přesunou na místo hlavních (obvykle dolů) a po zapnutí druhého jazyka se vrátí zpátky. Panel je vidět i ve fullscreenu a po chvíli bez pohybu myši zmizí. Zkratka Option + S skryje všechno, další stisk ukáže oboje.

**Pozice:** Style › Position = Dole / Uprostřed / Nahoře. Nahoře se odstup měří od horního okraje a Option + ↑ titulky posune výš (blíž k okraji).

**Rozmazané pozadí:** Style › Background box › **Blur** rozmaže video pod textem. Funguje i s průhledností krabičky 0 %, pak je to jen "matné sklo".

**Kliknutím zkopírovat:** klikni na řádek titulků na videu a jeho text se zkopíruje (přepínač Style › Behaviour › Click to copy, zapnutý). Kliknutí na text pak video nepozastaví; kliknutí jinam na video funguje normálně.

**Zopakovat větu:** Option + R vrátí video na začátek aktuálního řádku a pustí ho znovu. Když řádek právě začal (do 0,8 s) nebo je zrovna mezera mezi řádky, zopakuje ten předchozí, tedy ten, co jsi právě slyšel. Na webech, které nedovolí přetáčet, to nepůjde.

**Rozbitá diakritika (č, ř, ư, ế):** v rozšíření změň **Encoding** (pro české SRT většinou Windows-1250). Automatika pozná i staré japonské (Shift_JIS, EUC-JP), čínské (GBK, Big5) a korejské (EUC-KR) soubory.

**Jazyk rozhraní:** rozšíření mluví anglicky, česky, slovensky, německy, francouzsky, španělsky, vietnamsky a zjednodušenou čínsky. Řídí se jazykem prohlížeče; úplně dole v rozšíření je **Interface language**, kde ho přepneš ručně. Texty na videu (hlášky, karty) se přepnou po obnovení stránky. Překlady jsou v `lib/locales.js` (klíčem je anglický text; co chybí, zůstane anglicky), název a popis pro Chrome Web Store v `_locales/`.

## Klávesové zkratky (na stránce s videem)

| Akce | Zkratka |
| --- | --- |
| Titulky dřív / později o 0,1 s | Option + [ / ] |
| Dřív / později o 1 s | Option + Shift + [ / ] |
| Posun zpět na 0 | Option + 0 |
| Skrýt / ukázat titulky (oboje naráz) | Option + S, dá se změnit |
| Posunout titulky nahoru / dolů | Option + ↑ / ↓ |
| Fullscreen s titulky | Option + F |
| Zopakovat aktuální řádek | Option + R |

Zkratku na skrytí a ukázání titulků změníš v popupu: **Keyboard shortcuts** › **Change** u řádku Show / hide subtitles a pak stiskni nové klávesy (Esc zruší, ↺ vrátí Option + S). Klávesy, které už používá jiná zkratka rozšíření, nepřijme. Jde i samotná klávesa bez Option, jen pak přebije zkratku webu na stejné klávese.

Klávesy jsou podle fyzické polohy (na české klávesnici jsou [ a ] klávesy vpravo vedle P, tedy ú a ).

## Fullscreen

- Většina webů dává do fullscreenu celý přehrávač: titulky zůstanou vidět samy.
- Některé weby dávají do fullscreenu jen holé video. Přes něj nejde nic nakreslit. Pak použij **Option + F** nebo tlačítko **Fullscreen with subtitles**, které se ukáže nahoře uprostřed videa, když nad ním pohneš myší.

## Co to (zatím) neumí

- Titulky v jiných formátech než VTT/SRT (TTML, ASS, SMI, vlastní JSON) a šifrované titulky.
- Panel v DevTools je jen anglicky.
- Streamované titulky rozsekané v .m3u8 umí složit dohromady, ale jen když jsou kousky obyčejný text VTT.

## Zkušební soubory

Ve složce `samples`:
- `timing-test-video.mp4`: 2minutové testovací video s počítadlem sekund.
- `timing-test.vtt`, `timing-test-utf8.srt`: každých 5 s jeden řádek "Line N: should appear at M:SS", takže hned vidíš, jestli sedí čas.
- `timing-test-windows1250.srt`: totéž uložené ve Windows-1250 (test české diakritiky).

# slosh

[English](README.md) · **Česky**

### ▸ [Vyzkoušet na telefonu](https://paveljezelezny.github.io/slosh/)

Otevři ten odkaz na mobilu a nakloň ho. To je celá pointa.

---

Kapalina na webu, která ví, kudy je dolů.

Nakloň telefon a přeleje se ke spodní straně. Zatřes s ním a promísí se se
vzduchem — bubliny, pěna, všechno. Na desktopu, nebo když uživatel odmítne
přístup k senzorům, zůstane pomalé vlnění, které vypadá jako záměr, ne jako
rozbitá funkce.

Žádné závislosti. ~9 kB gzip. Jedno WebGL vykreslení a asi 15 tisíc operací
s plovoucí čárkou na snímek, takže to stojí baterii návštěvníka, ne tvůj hosting.

```js
import { createSlosh } from "slosh";

createSlosh(document.querySelector("canvas")).start();
```

## Proč ne prostě animovaná vlna

Protože nakreslená vlna neví, že je kapalina. Tady běží skutečná mělkovodní
simulace ve 128 sloupcích, takže přelití při náklonu, odraz od protější stěny
i dva tři zákmity, než se to uklidní, **vzniknou samy** — nikdo je nenaklíčoval.
Nakloň telefon a drž ho: hladina najde přesnou geometrickou rovinu. Zatřes s ním
a zbytek udělá princip ekvivalence.

Modul s fyzikou nemá DOM ani WebGL, takže si ho můžeš pustit v Node a ověřit sám:

```
perioda 1. módu             1,183 s
tlumení                     2,9e-2 → 7,1e-3 → 1,8e-3, klid za ~3 s
rovnovážný sklon pro 0,45   0,4500  (přesně)
objem po 30 s pohybu        0,00e+0 úniku
zatřesení vychýlí hladinu o 0,305 jednotky nádoby
cena                        0,0045 ms na snímek
```

## Instalace

```
npm install slosh
```

Nebo si zkopíruj `src/` do projektu — jsou to čtyři soubory prostých ES modulů
bez build kroku.

## Použití

```js
import { createSlosh } from "slosh";

const slosh = createSlosh(canvas, {
  level: 0.45,          // klidová hladina, 0 = spodek plátna, 1 = vršek
  maxSlope: 0.6,        // maximální náklon jako tan(úhlu); 0,6 ≈ 31°, 1,0 = 45°
  intensity: 0.9,       // celkové krytí
  idleBubbles: 1,       // řídké bublinky stoupají i v klidu, ať je hladina poznat
  fallback: "drift",    // "drift" | "pointer" | "still" když nejsou senzory
  colors: {
    deep:    "#0a2a5e",
    shallow: "#4d9ad6",
    film:    "#dbf0ff",
  },
});

slosh.start();
```

| metoda | co dělá |
|---|---|
| `start()` | připojí senzory a rozjede smyčku |
| `stop()` | odpojí všechno, poslední snímek nechá na plátně |
| `destroy()` | `stop()` a navíc uvolní GL kontext |
| `splash(0..1)` | rozhoupe kapalinu ručně, třeba z tlačítka |
| `status()` | `"granted"` \| `"waiting"` — pro vlastní výzvu v UI |
| `liquid` | samotná simulace, když chceš číst `h`, `u`, `energy` |

### V hero sekci

Plátno dej za text a nastav mu `pointer-events: none`:

```html
<section class="hero">
  <canvas id="water"></canvas>
  <div class="inner"><h1>…</h1></div>
</section>
```
```css
.hero { position: relative; overflow: hidden; }
.hero canvas { position: absolute; inset: 0; width: 100%; height: 100%;
               pointer-events: none; }
.hero .inner { position: relative; }
```

Funkční ukázky jsou v `examples/`:

- [`mockup.html`](https://paveljezelezny.github.io/slosh/examples/mockup.html) —
  hotová hero sekce s živým nastavením (hladina, krytí, náklon, čtyři palety)
  a tlačítkem, které schová UI pro natáčení
- [`hero.html`](https://paveljezelezny.github.io/slosh/examples/hero.html) —
  minimální ukázka kapaliny pod textem
- [`basic.html`](https://paveljezelezny.github.io/slosh/examples/basic.html) —
  jen plátno a tlačítko Splash

## Čtyři věci, které se snadno udělají špatně

Každá z nich stojí reálný čas na ladění, takže je lepší je říct rovnou.

**Používej `devicemotion`, ne `deviceorientation`.** `beta`/`gamma` jsou Eulerovy
úhly ZXY a jsou degenerované kolem `beta = 90°` — tedy přesně v poloze, ve které
lidi telefon při čtení drží. Náklon pak funguje na stole a v ruce ne. Tahle
knihovna místo toho filtruje gravitaci dolní propustí z
`accelerationIncludingGravity`: žádné úhly, žádný gimbal lock, spojité v každé
poloze.

**Zatřesení musí hnout kapalinou, ne jen spustit bubliny.** Zrychlení nádoby
vstupuje jako pseudosíla vedle gravitace — princip ekvivalence. Bez toho členu
hladina úplně stojí, zatímco se v ní objevují bubliny, což vypadá jako chyba.

**Hladinu skládej Catmull-Romem, ne smoothstepem.** Smoothstep mezi dvěma vzorky
má *v každém uzlu nulovou derivaci*, takže se sklon 128× za obrazovku srovná do
vodorovna. Z toho sklonu se počítá normála pro lesk, takže se láme i on a celek
vypadá rozpixelovaně. Čtyři vzorky a kubika to spraví.

**Nikdy neruš animační snímek natvrdo, když je klid.** Když smyčku probouzí jen
DOM události, senzorová data ji neprobudí — a kapalina se rodí v dokonalém klidu,
takže usne dřív, než dorazí první vzorek z akcelerometru. Pak vypadá zamrzle,
dokud se nedotkneš obrazovky. Tahle knihovna místo toho klesne na 10 Hz a dál
kontroluje; náklon pozná do 100 ms.

## Souhlas na iOS

iOS 13+ vyžaduje souhlas s přístupem k pohybu a vyžádat ho jde **jen synchronně
z uživatelského gesta**. Scroll se nepočítá.

Ve výchozím stavu se `slosh` zeptá při prvním klepnutí, které **není** na odkaz
ani tlačítko, takže nikdy neukradne klik na tvoje CTA. Když se raději chceš ptát
z vlastního tlačítka, předej `autoPermission: false` a zavolej si
`requestPermission()` sám uvnitř obsluhy kliknutí:

```js
import { createSlosh, requestPermission } from "slosh";
button.addEventListener("click", async () => {
  await requestPermission();   // musí být první, před jakýmkoli await
});
```

Souhlas na iOS nepřežije obnovení stránky. Prohlížeče uvnitř aplikací
(Instagram, Facebook) ho často odmítnou úplně — proto musí fallback obstát sám
o sobě.

## Požadavky a omezení

- WebGL1. `createSlosh` vrátí objekt, jehož `start()` neudělá nic, když se
  kontext nepodaří vytvořit — degraduje tedy do ničeho, nespadne.
- **HTTPS.** `devicemotion` je mimo secure context blokované. `localhost`
  funguje, `http://192.168.x.x` mlčí — a to je nejčastější mylná diagnóza
  „nefunguje to na mobilu".
- `prefers-reduced-motion` vykreslí jeden statický snímek a skončí.
- **Otočení obrazovky z webu zamknout nejde** — Chrome na Androidu to umí jen
  ve fullscreenu a Safari na iOS `lock()` neimplementuje vůbec. Neslibuj to.

## Ladění

Konstanty fyziky jsou nahoře v `src/liquid.js`: `G` určuje rychlost odezvy,
`DRAG` tlumení (`zeta = DRAG / 2*omega1`), `NU` jak rychle odumřou krátké vlnky.
`AER_TAU` a `FOAM_TAU` řídí, jak dlouho vydrží bubliny a pěna — pěna je schválně
pomalejší, protože právě to, že po zastavení pohybu **zůstane sedět**, z toho
dělá tenzid a ne vodu.

Jedna zdvojená konstanta: `HRES` v `src/liquid.js` je rozsah 16bitově kódované
výchylky hladiny a `src/renderer.js` dekóduje toutéž hodnotou. Importuje se,
takže stačí změnit ji na jednom místě — ale kdybys shader vložil někam jinam,
musí sedět obě.

## Licence

MIT. Dělej si s tím, co chceš.

## Kdo za tím stojí

**Pavel Železný** — [Pracovna.cz](https://pracovna.cz) | co:produkce, kde
vyvíjíme weby a aplikace na míru.

Vzniklo to při stavbě hero sekce pro výrobce profesionální mycí chemie. Pěna je
laděná na tenzid, ne na vodu, což se ukázalo jako zajímavější půlka problému:
pěna z detergentu po zastavení pohybu **zůstane**, a právě to z toho dělá něco
jiného než modrý přechod.

Issues a pull requesty vítány.

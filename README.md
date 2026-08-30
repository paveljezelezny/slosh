# slosh

**English** · [Česky](README.cs.md)

Liquid in a web page that knows which way is down.

Tilt the phone and it pours to the low side. Shake it and it aerates — bubbles,
foam, the lot. On a desktop, or when motion permission is denied, it falls back
to a slow swell that looks deliberate rather than broken.

No dependencies. ~9 kB gzipped. One WebGL draw call and about 15k float ops per
frame on the CPU, so it costs your visitors' battery rather than your hosting.

```js
import { createSlosh } from "slosh";

createSlosh(document.querySelector("canvas")).start();
```

## Why not just animate a wave

Because a drawn wave does not know it is liquid. This runs an actual 1D
shallow-water simulation across 128 columns, which means the overshoot when you
tilt, the reflection off the far wall and the two or three bounces before it
settles all *emerge* — nobody keyframed them. Tilt the phone and hold it: the
surface finds an exact geometric plane. Shake it: the equivalence principle does
the rest.

The physics module has no DOM and no WebGL, so you can run it in Node and check
it yourself:

```
period of first mode        1.183 s
damping                     2.9e-2 → 7.1e-3 → 1.8e-3, settles in ~3 s
equilibrium slope for 0.45  0.4500  (exact)
volume after 30 s of motion 0.00e+0 drift
shake displaces surface by  0.305 container units
cost                        0.0045 ms per frame
```

## Install

```
npm install slosh
```

Or copy `src/` into your project — it is four files of plain ES modules with no
build step.

## Use

```js
import { createSlosh } from "slosh";

const slosh = createSlosh(canvas, {
  level: 0.45,          // resting surface, 0 = bottom of the canvas, 1 = top
  maxSlope: 0.6,        // max tilt as tan(angle); 0.6 ≈ 31°, 1.0 = 45°
  intensity: 0.9,       // overall opacity
  idleBubbles: 1,       // sparse bubbles rise even when still, so the surface reads
  fallback: "drift",    // "drift" | "pointer" | "still" when there are no sensors
  colors: {
    deep:    "#0a2a5e",
    shallow: "#4d9ad6",
    film:    "#dbf0ff",
  },
});

slosh.start();
```

| method | what it does |
|---|---|
| `start()` | attach sensors and begin the loop |
| `stop()` | detach everything, keep the last frame |
| `destroy()` | `stop()` plus release the GL context |
| `splash(0..1)` | kick the liquid by hand, e.g. from a button |
| `status()` | `"granted"` \| `"waiting"` — for showing your own prompt |
| `liquid` | the simulation, if you want to read `h`, `u`, `energy` |

### In a hero section

Put the canvas behind your copy and give it `pointer-events: none`:

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

Working examples are in `examples/` — open `examples/hero.html` and
`examples/basic.html` from any static server.

## Four things that are easy to get wrong

These cost real debugging time, so they are worth stating plainly.

**Use `devicemotion`, not `deviceorientation`.** `beta`/`gamma` are ZXY Euler
angles and they are degenerate around `beta = 90°` — which is exactly how people
hold a phone while reading. Tilt then works on a table and fails in the hand.
This library low-pass filters gravity out of `accelerationIncludingGravity`
instead: no angles, no gimbal lock, continuous in every orientation.

**Shaking has to move the liquid, not just spawn bubbles.** Container
acceleration is fed in as a pseudo-force alongside gravity — the equivalence
principle. Without that term the surface stands perfectly still while bubbles
appear in it, which reads as a bug.

**Reconstruct the surface with Catmull-Rom, not smoothstep.** A smoothstep
between two samples has *zero derivative at every knot*, so the slope flattens
128 times across the screen. The specular normal comes from that slope, so the
highlight facets and the whole thing looks pixelated. Four taps and a cubic fix it.

**Never hard-cancel the animation frame when idle.** If the loop is only woken
by DOM events, sensor data will not wake it — and the liquid is born perfectly
still, so it falls asleep before the first accelerometer sample arrives. It then
appears frozen until you touch the screen. This library drops to 10 Hz instead
and keeps checking; tilt is noticed within 100 ms.

## iOS permission

iOS 13+ requires consent for motion, and it can only be requested synchronously
from a user gesture. Scrolling does not count.

By default `slosh` asks on the first tap that is **not** on a link or button, so
it never steals a click on your call to action. If you would rather ask from
your own button, pass `autoPermission: false` and call `requestPermission()`
yourself inside the click handler:

```js
import { createSlosh, requestPermission } from "slosh";
button.addEventListener("click", async () => {
  await requestPermission();   // must be first, before any await
});
```

Consent does not survive a reload on iOS. In-app browsers (Instagram, Facebook)
often refuse it entirely — which is why the fallback has to look intentional on
its own.

## Requirements and limits

- WebGL1. `createSlosh` returns an object whose `start()` is a no-op if the
  context cannot be created, so it degrades to nothing rather than throwing.
- **HTTPS.** `devicemotion` is blocked outside a secure context. `localhost`
  works; `http://192.168.x.x` silently does nothing, which is the most common
  false diagnosis of "it doesn't work on mobile".
- `prefers-reduced-motion` renders one flat frame and stops.
- Screen orientation cannot be locked from a web page — Chrome on Android needs
  fullscreen, and Safari on iOS does not implement `lock()` at all. Do not
  promise it.

## Tuning

Physics constants live at the top of `src/liquid.js`: `G` sets the response
speed, `DRAG` the damping (`zeta = DRAG / 2*omega1`), `NU` how fast short
ripples die. `AER_TAU` and `FOAM_TAU` control how long bubbles and foam last —
foam is deliberately slower, because surfactant foam surviving movement is what
sells it as detergent rather than water.

One duplicated constant to watch: `HRES` in `src/liquid.js` is the range of the
16-bit encoded surface residual, and `src/renderer.js` decodes with the same
value. It is imported, so changing it in one place is enough — but if you inline
the shader somewhere else, keep them in sync.

## Licence

MIT. Do what you like with it.

## Who made this

**Pavel Železný** — [Pracovna.cz](https://pracovna.cz) | co:produkce, a studio
building custom websites and applications.

It came out of a hero section for a maker of professional cleaning chemistry.
The foam is tuned for detergent rather than water, which turned out to be the
more interesting half of the problem: detergent foam *stays* after the movement
stops, and that is what sells it as something other than a blue gradient.

Issues and pull requests welcome.

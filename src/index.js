/**
 * slosh — liquid that reacts to how you tilt the phone.
 *
 * One entry point. Give it a canvas, get liquid.
 */

import { Liquid, G as SIM_G, TEX_BYTES } from "./liquid.js";
import { createRenderer } from "./renderer.js";
import { createSensors, needsPermission, requestPermission } from "./sensors.js";

export { Liquid, needsPermission, requestPermission };

const DEFAULTS = {
  /** Where the resting surface sits, 0 = bottom of the canvas, 1 = top. */
  level: 0.45,
  /** Maximum surface tilt as tan(angle). 0.42 is 23 degrees, 1.0 is 45. */
  maxSlope: 0.6,
  /** Overall opacity of the liquid. */
  intensity: 0.9,
  /** Sparse bubbles that rise even when the device is still, 0..1. */
  idleBubbles: 1,
  /** Cap on rendered pixels. Protects battery on 3x DPR screens. */
  maxDevicePixels: 1_150_000,
  colors: {
    deep: "#0a2a5e",
    shallow: "#4d9ad6",
    film: "#dbf0ff",
  },
  /**
   * What happens without motion sensors — desktop, denied permission,
   * in-app browsers. "drift" is a slow autonomous swell, "pointer" follows
   * the cursor, "still" leaves the surface flat.
   */
  fallback: "drift",
  /** Ask for iOS motion permission on the first touch outside a link or button. */
  autoPermission: true,
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options] see DEFAULTS
 * @returns {{start:Function, stop:Function, destroy:Function, splash:Function,
 *            sensors:object, liquid:Liquid, status:Function}}
 */
export function createSlosh(canvas, options = {}) {
  const o = { ...DEFAULTS, ...options, colors: { ...DEFAULTS.colors, ...(options.colors || {}) } };

  const reducedMotion =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const sim = new Liquid();
  const texData = new Uint8Array(TEX_BYTES);
  const renderer = createRenderer(canvas, o.colors);
  const sensors = createSensors({ lockOrientation: false });

  let running = false;
  let raf = 0;
  let last = 0;
  let t = 0;
  let fade = 0;
  let calm = 0;
  let sleeping = false;
  let fbT = 0;
  let pointerX = 0;
  let granted = !needsPermission();
  let cssW = 1;
  let cssH = 1;

  /* ---------- layout ---------- */

  const measure = () => {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;

  /* ---------- iOS permission without a dedicated button ---------- */

  const INTERACTIVE = "a,button,input,textarea,select,label,summary,[role='button']";
  let asked = false;
  const askOnGesture = (e) => {
    if (asked || granted) return;
    const el = e.target;
    // Do not steal the first tap on a link: a system dialog fired through an
    // outgoing navigation is worse than no liquid at all.
    if (el && typeof el.closest === "function" && el.closest(INTERACTIVE)) return;
    asked = true;
    detachAsk();
    // Must be synchronous inside the handler — any await burns the activation.
    requestPermission().then((ok) => {
      if (ok) {
        granted = true;
        sensors.start();
        wake();
      }
    });
  };
  const attachAsk = () => {
    document.addEventListener("touchend", askOnGesture, true);
    document.addEventListener("click", askOnGesture, true);
  };
  const detachAsk = () => {
    document.removeEventListener("touchend", askOnGesture, true);
    document.removeEventListener("click", askOnGesture, true);
  };

  /* ---------- fallback input ---------- */

  const onPointer = (e) => {
    pointerX = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    wake();
  };

  function wake() {
    sleeping = false;
    calm = 0;
  }

  /* ---------- loop ---------- */

  const frame = (now) => {
    raf = requestAnimationFrame(frame);

    // In the idle state the loop keeps running at 10 Hz and only advances the
    // simulation and checks for a wake-up. Nothing is drawn, so the last frame
    // stays on the canvas. Without this the loop would have to be woken by a
    // DOM event — and sensor data is not one, which is why a naive version
    // only comes alive once you touch the screen.
    const step = sleeping ? 100 : 15.4;
    if (now - last < step) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    t += dt;

    const s = sensors.data;
    let target, ax;
    if (s.live) {
      const down = Math.max(-s.gy, 0.35);      // how much of gravity is "down the screen"
      const raw = s.gx / down;
      // Soft knee instead of a hard clamp, so a crest never flattens out.
      const soft = o.maxSlope * Math.tanh(raw / o.maxSlope);
      // Phone lying flat: nothing in the plane of the display holds the liquid.
      target = soft * smoothstep(0.2, 0.45, -s.gy);
      ax = s.ax * (SIM_G / 9.80665);
    } else if (o.fallback === "pointer") {
      target = pointerX * o.maxSlope * 0.5;
      ax = 0;
    } else if (o.fallback === "drift") {
      fbT += dt;
      target = 0.030 * Math.sin(fbT * 0.55) + 0.020 * Math.sin(fbT * 0.31 + 1.7);
      ax = 0;
    } else {
      target = 0;
      ax = 0;
    }

    const shake = Math.max(s.fizz, s.agitation * 0.3);
    sim.advance(dt, target, ax, shake);

    if (sleeping) {
      if (sim.energy > 6e-5 || s.fizz > 0.02 || s.agitation > 0.03 ||
          Math.abs(target - sim.slope) > 4e-3) wake();
      return;
    }

    const budget = Math.sqrt(o.maxDevicePixels / Math.max(1, cssW * cssH));
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, budget));
    renderer.resize(Math.round(cssW * dpr), Math.round(cssH * dpr));

    fade = Math.min(1, fade + dt / 1.2);
    renderer.draw(sim, texData, {
      rest: o.level,
      ar: cssW / cssH,
      t,
      intensity: o.intensity * (fade * fade * (3 - 2 * fade)),
      idle: o.idleBubbles,
    });

    // Only a live sensor branch may idle. The fallback swell would put itself
    // to sleep: its longest quiet stretch is 1.86 s, longer than the window.
    const still =
      s.live && sim.energy < 2e-5 && s.fizz < 0.01 && s.agitation < 0.015 &&
      Math.abs(target - sim.slope) < 2e-3;
    calm = still ? calm + dt : 0;
    sleeping = calm > 1.5;
  };

  /* ---------- public API ---------- */

  return {
    start() {
      if (running || !renderer) return;
      running = true;
      measure();
      ro?.observe(canvas);
      window.addEventListener("resize", measure);

      if (reducedMotion) {
        // One flat frame and nothing else.
        renderer.resize(Math.round(cssW), Math.round(cssH));
        renderer.draw(sim, texData, {
          rest: o.level, ar: cssW / cssH, t: 0, intensity: o.intensity, idle: 0,
        });
        return;
      }

      if (granted) sensors.start();
      else if (o.autoPermission) attachAsk();
      if (o.fallback === "pointer") window.addEventListener("pointermove", onPointer, { passive: true });
      raf = requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      cancelAnimationFrame(raf);
      sensors.stop();
      detachAsk();
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onPointer);
    },

    destroy() {
      this.stop();
      renderer?.destroy();
    },

    /** Kick the liquid by hand, e.g. from a button. strength 0..1 */
    splash(strength = 1) {
      sensors.data.fizz = Math.min(1, sensors.data.fizz + strength);
      const n = sim.h.length;
      for (let i = 0; i < n; i++) {
        sim.u[i] += Math.sin((i / n) * Math.PI * 2) * strength * 1.4;
      }
      wake();
    },

    /** "unsupported" | "waiting" | "granted" — for showing a prompt in your UI. */
    status: () => (!needsPermission() ? "granted" : granted ? "granted" : "waiting"),

    sensors,
    liquid: sim,
  };
}

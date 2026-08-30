/**
 * Tilt and shake from the accelerometer. No framework, no dependencies.
 *
 * Uses `devicemotion`, NOT `deviceorientation`. beta/gamma are ZXY Euler angles
 * and they are degenerate around beta = 90 degrees — which is exactly how people
 * hold a phone while reading. Tilt then works on a table and fails in the hand.
 * Gravity is instead low-pass filtered out of accelerationIncludingGravity:
 * no angles, no gimbal lock, continuous in every orientation.
 */

const G = 9.80665;
const TAU_G = 0.35; // s - splits "tilt" from "shake"
const TAU_AX = 0.05; // s - smoothing of the pseudo-force
const TAU_AG = 0.25; // s - smoothing of continuous agitation
const SHAKE_ON = 12; // m/s²
const SHAKE_OFF = 5; // m/s2 - hysteresis
const REVERSALS = 3; // required direction reversals
const WINDOW_MS = 700;
const COOLDOWN_MS = 1200;
const FIZZ_TAU = 2.6; // s

/** Only WebKit (iOS) requires consent - and only it reports gravity inverted. */
export function needsPermission() {
  return (
    (typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function") ||
    (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function")
  );
}

/**
 * Request motion permission. MUST be called synchronously from a user gesture —
 * any await beforehand burns the user activation. A tap on your own button works.
 */
export function requestPermission() {
  const m = typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null;
  const o =
    typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null;
  // Never call both in a row - the second one has no activation left and throws.
  const p =
    m && typeof m.requestPermission === "function"
      ? m.requestPermission()
      : o && typeof o.requestPermission === "function"
        ? o.requestPermission()
        : Promise.resolve("granted");
  return p.then((r) => r === "granted").catch(() => false);
}

function screenAngle() {
  const a = typeof screen !== "undefined" ? screen.orientation?.angle : undefined;
  if (typeof a === "number") return a;
  const legacy = window.orientation;
  // window.orientation has the opposite sign to screen.orientation.angle.
  return typeof legacy === "number" ? (360 - legacy) % 360 : 0;
}

export function createSensors({ lockOrientation = true } = {}) {
  const out = {
    /** unit gravity vector in display axes, +x right, +y down */
    gx: 0,
    gy: 1,
    /** horizontal pseudo-force from container acceleration, m/s2 */
    ax: 0,
    ay: 0,
    /** 0..1 continuous agitation */
    agitation: 0,
    /** 0..1 strength of the last shake, decays on its own */
    fizz: 0,
    live: false,
  };

  let gvx = 0,
    gvy = 0,
    gvz = G;
  let seeded = false;
  let sign = needsPermission() ? -1 : 1;
  let signLocked = false;
  let last = 0;
  // When the page does not rotate, device axes are display axes and the
  // compensation would only break them.
  let angle = lockOrientation ? 0 : screenAngle();

  let armed = true,
    reversals = 0,
    windowStart = -1e9,
    lastDir = 0,
    peak = 0,
    lastShake = -1e9;
  let ux = 0,
    uy = 0,
    uz = 0;

  const onAngle = () => {
    if (!lockOrientation) angle = screenAngle();
  };

  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;

    const now = e.timeStamp || performance.now();
    const ivRaw = typeof e.interval === "number" ? e.interval : 0;
    // Chrome reports interval in ms, some WebKit builds in seconds.
    const iv = ivRaw > 1 ? ivRaw / 1000 : ivRaw;
    let dt = iv > 0 ? iv : last ? (now - last) / 1000 : 1 / 60;
    last = now;
    dt = Math.min(0.05, Math.max(1 / 200, dt));

    const rx = a.x * sign,
      ry = a.y * sign,
      rz = a.z * sign;

    if (!seeded) {
      gvx = rx;
      gvy = ry;
      gvz = rz;
      seeded = true;
    }
    const k = 1 - Math.exp(-dt / TAU_G);
    gvx += (rx - gvx) * k;
    gvy += (ry - gvy) * k;
    gvz += (rz - gvz) * k;

    const hx = rx - gvx,
      hy = ry - gvy,
      hz = rz - gvz;
    const mag = Math.hypot(hx, hy, hz);

    // --- shake: amplitude AND oscillation; neither alone is enough ---
    if (mag > SHAKE_ON) {
      if (now - windowStart > WINDOW_MS) {
        windowStart = now;
        reversals = 0;
        peak = 0;
        ux = hx / mag;
        uy = hy / mag;
        uz = hz / mag;
        lastDir = 1;
      } else {
        const dir = hx * ux + hy * uy + hz * uz > 0 ? 1 : -1;
        if (dir !== lastDir) {
          reversals++;
          lastDir = dir;
        }
      }
      if (mag > peak) peak = mag;
      if (armed && reversals >= REVERSALS && now - lastShake > COOLDOWN_MS) {
        const strength = Math.min(1, (peak - SHAKE_ON) / 18);
        out.fizz = Math.min(1, out.fizz + 0.35 + strength * 0.65);
        lastShake = now;
        armed = false;
      }
    } else if (mag < SHAKE_OFF) {
      armed = true;
      if (now - windowStart > WINDOW_MS) {
        reversals = 0;
        peak = 0;
      }
    }

    const ag = Math.min(1, mag / SHAKE_ON);
    out.agitation += (ag - out.agitation) * (1 - Math.exp(-dt / TAU_AG));
    out.fizz *= Math.exp(-dt / FIZZ_TAU);

    // --- gravity into display axes ---
    const n = Math.hypot(gvx, gvy, gvz) || 1;
    // accelerationIncludingGravity points UP (reaction force), so down is -g.
    const dx = -gvx / n,
      dy = -gvy / n;
    const th = (angle * Math.PI) / 180;
    const c = Math.cos(th),
      s = Math.sin(th);
    const px = dx * c - dy * s;
    const py = dx * s + dy * c;
    out.gx = px;
    // device +y points to the top edge, display +y points down
    out.gy = py;

    const kx = 1 - Math.exp(-dt / TAU_AX);
    const ex = -hx / G,
      ey = -hy / G;
    const pax = (ex * c - ey * s) * G;
    const pay = (ex * s + ey * c) * G;
    out.ax += (Math.max(-25, Math.min(25, pax)) - out.ax) * kx;
    out.ay += (Math.max(-25, Math.min(25, pay)) - out.ay) * kx;
    out.live = true;
  };

  /** Verify the accelerometer sign without sniffing the platform. */
  const onOrient = (e) => {
    if (signLocked || !seeded) return;
    const b = e.beta,
      gm = e.gamma;
    if (b == null || gm == null) return;
    if (Math.abs(b) > 60) return; // gamma is degenerate near vertical
    const rb = (b * Math.PI) / 180,
      rg = (gm * Math.PI) / 180;
    const ex = Math.cos(rb) * Math.sin(rg);
    const ey = -Math.sin(rb);
    const ez = -Math.cos(rb) * Math.cos(rg);
    const dot = ex * gvx + ey * gvy + ez * gvz;
    if (Math.abs(dot) < G * 0.5) return;
    if (dot > 0) {
      sign = -sign;
      gvx = -gvx;
      gvy = -gvy;
      gvz = -gvz;
    }
    signLocked = true;
  };

  function start() {
    window.addEventListener("devicemotion", onMotion, { passive: true });
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    screen.orientation?.addEventListener?.("change", onAngle);
    window.addEventListener("orientationchange", onAngle);
  }
  function stop() {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrient);
    screen.orientation?.removeEventListener?.("change", onAngle);
    window.removeEventListener("orientationchange", onAngle);
  }

  return { data: out, start, stop };
}

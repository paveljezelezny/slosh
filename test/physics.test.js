/**
 * The physics has no DOM and no WebGL, so it can be checked here rather than
 * by staring at a phone. Run with: node test/physics.test.js
 */
import { Liquid, N, HRES, TEX_BYTES } from "../src/liquid.js";

const DT = 1 / 60;
let failed = 0;

function check(name, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${actual} (expected ${expected} ±${tol})`);
}

const L = new Liquid();

// --- first sloshing mode: period and damping ---
L.reset();
const series = [];
for (let f = 0; f < 60 * 8; f++) { L.advance(DT, 0.3, 0, 0); series.push(L.h[0]); }
const peaks = [];
for (let i = 1; i < series.length - 1; i++)
  if (series[i] > series[i - 1] && series[i] >= series[i + 1]) peaks.push(i * DT);
check("period of first mode (s)", +(peaks[1] - peaks[0]).toFixed(3), 1.18, 0.05);

// --- equilibrium surface is an exact geometric plane ---
L.reset();
for (let f = 0; f < 60 * 20; f++) L.advance(DT, 0.45, 0, 0);
check("equilibrium slope", +((L.h[N - 1] - L.h[0]) / ((N - 1) / N)).toFixed(4), 0.45, 1e-3);

// --- volume is conserved through 30 s of motion and shaking ---
L.reset();
let before = 0;
for (let i = 0; i < N; i++) before += L.h[i];
for (let f = 0; f < 60 * 30; f++)
  L.advance(DT, 0.3 * Math.sin(f * DT * 2), f % 40 < 8 ? 14 : 0, 0.4);
let after = 0;
for (let i = 0; i < N; i++) after += L.h[i];
check("volume drift", +Math.abs(after - before).toExponential(1), 0, 1e-9);

// --- shaking must actually displace the surface ---
L.reset();
let peak = 0;
for (let f = 0; f < 60 * 3; f++) {
  L.advance(DT, 0, 18 * Math.sin(2 * Math.PI * 5 * f * DT), 1);
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L.h[i]));
}
check("surface displacement when shaken", +peak.toFixed(3), 0.30, 0.10);

// --- a phone held still at an angle must not produce foam forever ---
L.reset();
for (let f = 0; f < 60 * 50; f++) L.advance(DT, 0.45, 0, 0);
check("foam under static tilt", +L.foamMax.toFixed(6), 0, 1e-4);

// --- the encoded residual must stay inside the 16-bit range at 45 degrees ---
L.reset();
let maxRes = 0;
for (let f = 0; f < 60 * 6; f++) {
  L.advance(DT, 1.0, 0, 0);
  for (let i = 0; i < N; i++) {
    const r = L.h[i] - L.slope * ((i + 0.5) / N - 0.5);
    maxRes = Math.max(maxRes, Math.abs(r));
  }
}
console.log(`ok    encoded residual at 45°: ${maxRes.toFixed(3)} of HRES ${HRES} (${(HRES / maxRes).toFixed(2)}x headroom)`);
if (maxRes > HRES) { console.log("FAIL  residual exceeds HRES, encoding would clip"); failed++; }

// --- encode fills the whole buffer ---
const buf = new Uint8Array(TEX_BYTES);
L.encode(buf);
check("encoded bytes", buf.length, TEX_BYTES, 0);

// --- cost per frame ---
L.reset();
const t0 = process.hrtime.bigint();
for (let f = 0; f < 6000; f++) L.advance(DT, 0.2, 3, 0.2);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 6000;
console.log(`ok    ${ms.toFixed(4)} ms per frame`);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

/**
 * 1D shallow-water simulation of liquid in a closed container.
 *
 * The container is one unit wide. Surface heights are measured in the same
 * unit as the width, so the surface slope is directly tan(angle) and no aspect
 * ratio conversion happens here — that is applied at render time.
 *
 * No DOM, no WebGL. Runs in Node, so you can test it on its own.
 */

export const N = 128;
const DX = 1 / N;

/**
 * "Cinematic" gravity. The equilibrium surface comes out geometrically correct
 * for ANY value of G; this only tunes how fast the liquid responds.
 * c = sqrt(G * H0) = 1.732, so the first sloshing mode has a period of 1.18 s.
 */
export const G = 6.0;
const H0 = 0.5;

/** Viscosity as a Laplacian on velocity. Eats short ripples, keeps mode 1 alive. */
const NU = 0.09;
/** Global damping. zeta = DRAG / (2 * omega1) = 0.22 — settles in ~3 s, two or three bounces. */
const DRAG = 2.3;
/** Fixed substep. CFL = c * SUB / DX = 0.739. */
const SUB = 1 / 300;

/**
 * Range of the encoded surface residual (16-bit).
 * IMPORTANT: the renderer decodes with the same constant. If you change it
 * here, change it in `renderer.js` too.
 */
export const HRES = 0.45;
const UMAX = 3.0;

/** Entrained air decays fast; foam is slow and survives movement. */
const AER_TAU = 2.6;
const FOAM_TAU = 4.5;
/** How fast the target slope is approached. Sensors tick at ~16 ms; steps would kick the liquid. */
const SLOPE_TAU = 0.09;

export const TEX_W = N;
export const TEX_H = 2;
export const TEX_BYTES = TEX_W * TEX_H * 4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Liquid {
  constructor() {
    /** Surface displacement from rest, in container units. */
    this.h = new Float32Array(N);
    /** Horizontal flux at cell walls. u[0] and u[N] are the container walls. */
    this.u = new Float32Array(N + 1);
    /** Entrained air per column, 0..1. */
    this.aer = new Float32Array(N);
    /** Foam sitting on the surface, 0..1. */
    this.foam = new Float32Array(N);

    /** Slope of the equilibrium plane currently in use (tan of the angle). */
    this.slope = 0;
    /** max(aer) — goes into a uniform so the bubble branch stays coherent. */
    this.aerMax = 0;
    /** max(foam) */
    this.foamMax = 0;

    this._tu = new Float32Array(N + 1);
    this._ta = new Float32Array(N);
    this._acc = 0;
  }

  reset() {
    this.h.fill(0);
    this.u.fill(0);
    this.aer.fill(0);
    this.foam.fill(0);
    this.slope = 0;
    this._acc = 0;
  }

  /**
   * @param {number} dt     real frame time, seconds
   * @param {number} target target surface slope = tan(angle), from gravity
   * @param {number} ax     horizontal pseudo-force in simulation units
   * @param {number} shake  0..1 how much energy goes into aeration
   */
  advance(dt, target, ax, shake) {
    this.slope += (target - this.slope) * (1 - Math.exp(-dt / SLOPE_TAU));

    // Equivalence principle: acceleration of the container is indistinguishable
    // from gravity. Without this term shaking does not move the surface at all
    // and bubbles appear in a standing liquid.
    const gx = G * this.slope + ax;

    // Do not replay an hour of simulation after coming back from another tab.
    this._acc = Math.min(this._acc + dt, 0.1);
    while (this._acc >= SUB) {
      this._acc -= SUB;
      this._fluid(gx);
    }
    this._air(dt, shake);
  }

  _fluid(gx) {
    const { h, u, _tu: tu, aer, _ta: ta } = this;
    const dt = SUB;

    // Momentum: pressure gradient plus the component of gravity along the display.
    // Equilibrium: (h[i] - h[i-1]) / DX = gx / G = slope — an exact geometric plane.
    for (let i = 1; i < N; i++) u[i] += ((G * (h[i - 1] - h[i])) / DX + gx) * dt;
    u[0] = 0;
    u[N] = 0;

    tu.set(u);
    const d = 1 - DRAG * dt;
    for (let i = 1; i < N; i++)
      u[i] = (tu[i] + NU * (tu[i - 1] - 2 * tu[i] + tu[i + 1])) * d;

    // Continuity. The flux sum telescopes to u[N] - u[0] = 0, so volume is
    // conserved exactly and the liquid never drifts away, even after minutes.
    const k = (H0 / DX) * dt;
    for (let i = 0; i < N; i++) h[i] -= (u[i + 1] - u[i]) * k;

    // Semi-Lagrangian advection of air, inside the SUBSTEP. With the frame dt
    // a cloud of bubbles would smear faster when the frame rate drops.
    const c = dt / DX;
    for (let i = 0; i < N; i++) {
      const x = i - 0.5 * (u[i] + u[i + 1]) * c;
      const i0 = Math.floor(x);
      const f = x - i0;
      const j0 = clamp(i0, 0, N - 1);
      const j1 = clamp(i0 + 1, 0, N - 1);
      ta[i] = aer[j0] + (aer[j1] - aer[j0]) * f;
    }
    aer.set(ta);
  }

  _air(dt, shake) {
    const { u, h, aer, foam } = this;
    const da = Math.exp(-dt / AER_TAU);
    const df = Math.exp(-dt / FOAM_TAU);
    const s = this.slope;
    let am = 0,
      fm = 0;

    for (let i = 0; i < N; i++) {
      // Velocity shear plus steepness of the RESIDUAL (not of raw h). Computed
      // from the raw surface, a statically tilted phone would produce foam forever.
      const shear = Math.abs(u[i + 1] - u[i]) / DX;
      const ia = i > 0 ? i - 1 : 0;
      const ib = i < N - 1 ? i + 1 : N - 1;
      const ra = h[ia] - s * ((ia + 0.5) * DX - 0.5);
      const rb = h[ib] - s * ((ib + 0.5) * DX - 0.5);
      const steep = Math.abs(rb - ra) / ((ib - ia) * DX);
      const t = Math.min(1, shear * 0.05 + steep * 0.6);
      // Breaking crest: foam forms without shaking too, but only past real steepness.
      const brk = Math.max(0, steep - 0.35);

      const a = Math.min(1, aer[i] * da + shake * t * dt * 2.4);
      const f = Math.min(1, foam[i] * df + (shake * 0.7 + brk) * t * dt * 1.8);
      aer[i] = a;
      foam[i] = f;
      if (a > am) am = a;
      if (f > fm) fm = f;
    }
    this.aerMax = am;
    this.foamMax = fm;
  }

  /**
   * Energy of the system — the right quantity for detecting stillness.
   * max|u| is wrong: in a standing wave the velocity crosses zero twice per
   * period across the whole container, so "calm" would trigger mid-slosh.
   */
  get energy() {
    const { h, u } = this;
    const s = this.slope;
    let e = 0;
    for (let i = 0; i <= N; i++) e += u[i] * u[i];
    for (let i = 0; i < N; i++) {
      const r = h[i] - s * ((i + 0.5) * DX - 0.5);
      e += (G / H0) * r * r;
    }
    return e / N;
  }

  /**
   * Write state into a 128x2 RGBA texture (1024 B).
   *   row 0: R,G = 16-bit surface residual, B = flux, A = foam
   *   row 1: R = entrained air, G,B,A = reserved
   *
   * The tilt plane is subtracted here and added back in the shader as an exact
   * float. A phone held still at an angle therefore has a residual of zero, so
   * nothing of the quantisation is visible.
   */
  encode(out) {
    const { h, u, foam, aer } = this;
    const s = this.slope;
    for (let i = 0; i < N; i++) {
      const o = i << 2;
      const res = h[i] - s * ((i + 0.5) * DX - 0.5);
      // 16-bit packing: w = r + g/255, both components <= 1, safe in mediump
      const w = clamp(res / HRES, -1, 1) * 0.5 + 0.5;
      const hi = Math.min(255, Math.floor(w * 255));
      const lo = Math.min(255, Math.round((w * 255 - hi) * 255));
      out[o] = hi;
      out[o + 1] = lo;
      out[o + 2] = clamp((0.5 * (u[i] + u[i + 1])) / UMAX, -1, 1) * 127.5 + 127.5;
      out[o + 3] = foam[i] * 255;

      const o2 = (N + i) << 2;
      out[o2] = aer[i] * 255;
      out[o2 + 1] = 0;
      out[o2 + 2] = 0;
      out[o2 + 3] = 0;
    }
  }
}
